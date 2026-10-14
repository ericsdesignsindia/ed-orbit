import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { currentTenantId } from "./tenant";

const TOKEN_COOKIE = "signal_meta_session";
const STATE_COOKIE = "signal_meta_state";
const MAX_SESSION_SECONDS = 60 * 24 * 60 * 60;
const LOGIN_CONFIG_ID = "1451143900244422";
type Environment = Record<string, string | undefined>;
export type MetaConfig = { appId: string; appSecret: string; baseUrl: string; key: string; graphVersion: string };
type MetaToken = { kind: "tokens"; accessToken: string; expiresAt: number | null; sessionExpiresAt: number; sessionId: string };
type MetaState = { kind: "state"; state: string; expiresAt: number; tenantId?: string };
type MetaPage = { id: string; name: string; instagram?: { id: string; username: string } };
export class MetaError extends Error {
  constructor(message: string, public status = 400, public reconnectNeeded = false, public phase?: string, public providerCode?: number, public providerSubcode?: number, public providerMessage?: string) { super(message); }
}

const vaultPath = () => path.join(process.env.ORBIT_DATA_DIR || path.join(process.cwd(), ".data"), "meta-session.enc");
const aad = Buffer.from("signal:meta:v1");
async function scopedCookieName(base: string, tenantId?: string) {
  const id = tenantId ?? await currentTenantId();
  return id === "legacy" ? base : `${base}_${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
}
export function encryptMeta(value: unknown, key: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv); cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function decryptMeta<T>(value: string, key: string): T | undefined {
  try {
    if (value.length > 12000 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
    const bytes = Buffer.from(value, "base64url"); if (bytes.length < 29) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), bytes.subarray(0, 12)); decipher.setAAD(aad); decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { return undefined; }
}
function validToken(value: MetaToken | undefined): value is MetaToken {
  return !!value && value.kind === "tokens" && typeof value.accessToken === "string" && value.accessToken.length > 0 && value.accessToken.length < 4096 && (value.expiresAt === null || Number.isFinite(value.expiresAt)) && Number.isFinite(value.sessionExpiresAt) && value.sessionExpiresAt > Date.now();
}

export function readMetaConfig(env: Environment = process.env): { config?: MetaConfig; missing: string[] } {
  const missing: string[] = [];
  if (!env.META_APP_ID?.trim()) missing.push("META_APP_ID");
  if (!env.META_APP_SECRET?.trim()) missing.push("META_APP_SECRET");
  if (!/^[a-f\d]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY ?? "")) missing.push("TOKEN_ENCRYPTION_KEY");
  const baseUrl = env.APP_BASE_URL ?? (env.VERCEL === "1" ? "https://seo-command-center-six.vercel.app" : "http://localhost:3000");
  try {
    const url = new URL(baseUrl); const local = env.VERCEL !== "1" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) && ["http:", "https:"].includes(url.protocol);
    const hosted = env.VERCEL === "1" && url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    if ((!local && !hosted) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
  } catch { missing.push("APP_BASE_URL"); }
  const graphVersion = env.META_GRAPH_API_VERSION?.trim() || "v22.0";
  if (!/^v\d+\.0$/.test(graphVersion)) missing.push("META_GRAPH_API_VERSION");
  if (missing.length) return { missing };
  return { missing, config: { appId: env.META_APP_ID!.trim(), appSecret: env.META_APP_SECRET!.trim(), baseUrl: new URL(baseUrl).origin, key: env.TOKEN_ENCRYPTION_KEY!, graphVersion } };
}
export function requireMetaConfig(): MetaConfig {
  const { config, missing } = readMetaConfig();
  if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
  return config;
}

export function metaRequestOrigin(request: Request): string {
  const protocol = new URL(request.url).protocol; const host = request.headers.get("host");
  if (!host || !["http:", "https:"].includes(protocol)) throw new MetaError("Meta connection is available only on the app host.", 403);
  let origin: URL; try { origin = new URL(`${protocol}//${host}`); } catch { throw new MetaError("Invalid app host.", 403); }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname.toLowerCase());
  const validHost = process.env.VERCEL === "1" ? protocol === "https:" && !localHost : localHost;
  if (!validHost || origin.host.toLowerCase() !== host.toLowerCase() || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new MetaError("Meta connection is unavailable on this host.", 403);
  return origin.origin;
}
export function assertMetaRequest(request: Request, mutation = false): void {
  const local = metaRequestOrigin(request); const origin = request.headers.get("origin");
  if ((origin && origin !== local) || (mutation && origin !== local)) throw new MetaError("A same-origin request is required.", 403);
  const crossSite = request.headers.get("sec-fetch-site") === "cross-site";
  const connectNavigation = new URL(request.url).pathname === "/api/meta/connect" && request.method === "GET" && request.headers.get("sec-fetch-mode") === "navigate" && request.headers.get("sec-fetch-dest") === "document";
  if (crossSite && new URL(request.url).pathname !== "/api/meta/callback" && !connectNavigation) throw new MetaError("Cross-site requests are not allowed.", 403);
}
function cookieOptions(config: MetaConfig, maxAge: number) { return { httpOnly: true, secure: config.baseUrl.startsWith("https:"), sameSite: "lax" as const, path: "/", maxAge } as const; }

async function writeVault(tokens: MetaToken, config: MetaConfig): Promise<void> {
  const encrypted = encryptMeta(tokens, config.key);
  if (process.env.VERCEL === "1") { const { writeHostedMetaVault } = await import("./neon-meta-vault"); await writeHostedMetaVault(encrypted); return; }
  const destination = vaultPath(); await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomBytes(12).toString("hex")}.tmp`;
  try { await writeFile(temporary, encrypted, { mode: 0o600, flag: "wx" }); await rename(temporary, destination); await chmod(destination, 0o600); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function readVault(config: MetaConfig): Promise<MetaToken | undefined> {
  let encrypted: string | undefined;
  if (process.env.VERCEL === "1") { const { readHostedMetaVault } = await import("./neon-meta-vault"); encrypted = await readHostedMetaVault(); }
  else { try { encrypted = await readFile(vaultPath(), "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new MetaError("The local Meta session could not be read.", 503); } }
  if (!encrypted) return undefined;
  const tokens = decryptMeta<MetaToken>(encrypted, config.key);
  if (!validToken(tokens)) throw new MetaError("The saved Meta session is invalid. Reconnect the account.", 401, true);
  return tokens;
}
async function clearVault(): Promise<void> {
  if (process.env.VERCEL === "1") { const { clearHostedMetaVault } = await import("./neon-meta-vault"); await clearHostedMetaVault(); return; }
  try { await unlink(vaultPath()); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new MetaError("The local Meta session could not be cleared.", 503); }
}

async function saveTokens(tokens: MetaToken, config: MetaConfig): Promise<void> {
  const jar = await cookies(); await writeVault(tokens, config);
  jar.set(await scopedCookieName(TOKEN_COOKIE), encryptMeta(tokens, config.key), cookieOptions(config, Math.max(0, Math.floor((tokens.sessionExpiresAt - Date.now()) / 1000))));
}
function validObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
async function graphJson(config: MetaConfig, pathOrUrl: string, params: Record<string, string>, method = "GET", phase = pathOrUrl): Promise<Record<string, unknown>> {
  const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : new URL(`https://graph.facebook.com/${config.graphVersion}/${pathOrUrl.replace(/^\/+/, "")}`);
  if (method === "POST") {
    // Keep access tokens out of request URLs and intermediary URL logs.
  } else for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { method, ...(method === "POST" ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    if (Number(response.headers.get("content-length")) > 1_000_000) { await response.body?.cancel(); throw new Error(); }
    const text = await response.text(); if (text.length > 1_000_000) throw new Error();
    let body: unknown; try { body = JSON.parse(text); } catch { throw new Error(); }
    if (!response.ok || !validObject(body)) {
      const meta = validObject(body) && validObject(body.error) ? body.error : undefined;
      const code = Number(meta?.code);
      if (code === 190 || response.status === 401) throw new MetaError("Meta authorization expired or was revoked. Reconnect the account.", 401, true);
      if (response.status === 403) throw new MetaError("Meta denied access. Check that your account manages a Page and that the app has the requested permissions.", 403);
      if (response.status === 429) throw new MetaError("Meta rate limit reached. Try again later.", 429);
      const providerSubcode = Number(meta?.error_subcode);
      let providerMessage = typeof meta?.message === "string" ? meta.message.slice(0, 240) : undefined;
      if (providerMessage) {
        for (const [key, value] of Object.entries(params)) if (["code", "client_secret", "access_token", "fb_exchange_token"].includes(key) && value) providerMessage = providerMessage.split(value).join("[redacted]");
        providerMessage = providerMessage.replace(/\b(?:EA|IG|AA)[A-Za-z0-9_-]{20,}\b/g, "[redacted]");
      }
      throw new MetaError("Meta could not complete the request. Check the app permissions and try again.", response.status >= 500 ? 502 : 400, false, phase, Number.isSafeInteger(code) ? code : undefined, Number.isSafeInteger(providerSubcode) ? providerSubcode : undefined, providerMessage);
    }
    return body;
  } catch (error) { if (error instanceof MetaError) throw error; throw new MetaError("Meta is unavailable or returned an invalid response. Try again.", 502); }
}
function parseAccessToken(value: Record<string, unknown>): { accessToken: string; expiresIn?: number } {
  if (typeof value.access_token !== "string" || value.access_token.length < 20 || value.access_token.length > 4096 || (value.token_type !== undefined && String(value.token_type).toLowerCase() !== "bearer")) throw new MetaError("Meta did not return a valid access token.", 502);
  // Facebook Login for Business can return a business/system-user token without
  // expires_in (or with 0). Keep the session bounded locally, while treating a
  // missing provider expiry as non-expiring. User tokens still carry a lifetime.
  const rawExpiry = value.expires_in;
  const expiresIn = rawExpiry === undefined || rawExpiry === null || rawExpiry === 0 || rawExpiry === "0" ? undefined : Number(rawExpiry);
  if (expiresIn !== undefined && (!Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 90 * 24 * 60 * 60)) throw new MetaError("Meta returned an unexpected token lifetime. Try connecting again.", 502);
  return { accessToken: value.access_token, expiresIn };
}

export async function startMetaOAuth(config: MetaConfig, tenantId?: string): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  (await cookies()).set(await scopedCookieName(STATE_COOKIE, tenantId), encryptMeta({ kind: "state", state, tenantId, expiresAt: Date.now() + 10 * 60_000 } satisfies MetaState, config.key), cookieOptions(config, 600));
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: config.appId, redirect_uri: `${config.baseUrl}/api/meta/callback`, config_id: LOGIN_CONFIG_ID, response_type: "code", override_default_response_type: "true", state }).toString();
  return url.toString();
}
export async function finishMetaOAuth(request: Request, config: MetaConfig, tenantId?: string): Promise<void> {
  const jar = await cookies(); const stateCookie = await scopedCookieName(STATE_COOKIE, tenantId); const raw = jar.get(stateCookie)?.value; jar.delete(stateCookie);
  const state = raw ? decryptMeta<MetaState>(raw, config.key) : undefined; const url = new URL(request.url); const received = url.searchParams.get("state") ?? ""; const code = url.searchParams.get("code");
  if (metaRequestOrigin(request) !== config.baseUrl || !state || state.kind !== "state" || (tenantId !== undefined && state.tenantId !== tenantId) || typeof state.state !== "string" || !Number.isFinite(state.expiresAt) || state.expiresAt <= Date.now() || Buffer.byteLength(received) !== Buffer.byteLength(state.state) || !timingSafeEqual(Buffer.from(received), Buffer.from(state.state)) || !code || code.length > 4096 || url.searchParams.has("error")) throw new MetaError("Meta authorization could not be completed.");
  const short = parseAccessToken(await graphJson(config, "oauth/access_token", { client_id: config.appId, client_secret: config.appSecret, redirect_uri: `${config.baseUrl}/api/meta/callback`, code }, "GET", "short_token_exchange"));
  const long = short.expiresIn === undefined ? short : parseAccessToken(await graphJson(config, "oauth/access_token", { grant_type: "fb_exchange_token", client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: short.accessToken }, "GET", "long_token_exchange"));
  const expiresAt = long.expiresIn === undefined ? null : Date.now() + long.expiresIn * 1000;
  const token: MetaToken = { kind: "tokens", accessToken: long.accessToken, expiresAt, sessionExpiresAt: Math.min(expiresAt ?? Number.MAX_SAFE_INTEGER, Date.now() + MAX_SESSION_SECONDS * 1000), sessionId: randomBytes(24).toString("hex") };
  await graphJson(config, "me", { fields: "id,name", access_token: token.accessToken }, "GET", "profile_verification");
  await saveTokens(token, config);
}

async function session(config: MetaConfig): Promise<MetaToken | undefined> {
  const jar = await cookies(); const tokenCookie = await scopedCookieName(TOKEN_COOKIE); const raw = jar.get(tokenCookie)?.value; const browser = raw ? decryptMeta<MetaToken>(raw, config.key) : undefined;
  if (!validToken(browser)) { if (raw) jar.delete(tokenCookie); return undefined; }
  const saved = await readVault(config);
  if (!saved || saved.sessionId !== browser.sessionId) { jar.delete(tokenCookie); throw new MetaError("This browser is not connected to the saved Meta session. Connect again.", 401, true); }
  if (saved.expiresAt !== null && saved.expiresAt <= Date.now()) { jar.delete(tokenCookie); await clearVault(); throw new MetaError("Meta authorization expired. Reconnect the account.", 401, true); }
  return saved;
}
async function managedPages(config: MetaConfig, token: MetaToken): Promise<MetaPage[]> {
  const response = await graphJson(config, "me/accounts", { fields: "id,name,access_token,tasks,instagram_business_account{id,username}", access_token: token.accessToken });
  if (!Array.isArray(response.data) || response.data.length > 500) throw new MetaError("Meta returned an invalid Page list.", 502);
  return response.data.map(value => {
    if (!validObject(value) || typeof value.id !== "string" || typeof value.name !== "string") return undefined;
    const linked = validObject(value.instagram_business_account) ? value.instagram_business_account : undefined;
    const instagramId = typeof linked?.id === "string" ? linked.id : undefined;
    return { id: value.id, name: value.name.slice(0, 200), ...(instagramId ? { instagram: { id: instagramId, username: typeof linked?.username === "string" ? linked.username.slice(0, 100) : "Instagram professional account" } } : {}) } satisfies MetaPage;
  }).filter((value): value is MetaPage => !!value);
}

type MetaPublishInput = { platform: "Facebook" | "Instagram"; caption: string; assetUrl: string; type: "Carousel" | "Reel" | "Static" | "Video" };
type PublishPage = { id: string; name: string; link?: string; accessToken: string; instagram?: { id: string; username: string } };
function normalizedName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
async function publishingPage(config: MetaConfig, token: MetaToken): Promise<PublishPage> {
  const result = await graphJson(config, "me/accounts", { fields: "id,name,link,access_token,instagram_business_account{id,username}", access_token: token.accessToken });
  if (!Array.isArray(result.data) || result.data.length > 500) throw new MetaError("Meta returned an invalid Page list.", 502);
  const target = result.data.find(value => validObject(value) && typeof value.id === "string" && typeof value.name === "string" && normalizedName(value.name) === "ericsdesigns" && typeof value.access_token === "string");
  if (!validObject(target) || typeof target.id !== "string" || typeof target.name !== "string" || typeof target.access_token !== "string") throw new MetaError("The Eric's Designs Facebook Page was not returned by Meta. Check Page access and reconnect.", 403);
  const linked = validObject(target.instagram_business_account) ? target.instagram_business_account : undefined;
  return { id: target.id, name: target.name, ...(typeof target.link === "string" ? { link: target.link } : {}), accessToken: target.access_token,
    ...(typeof linked?.id === "string" && typeof linked.username === "string" ? { instagram: { id: linked.id, username: linked.username } } : {}) };
}
function httpsAsset(value: string): string {
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(); return url.toString(); }
  catch { throw new MetaError("Instagram needs a public HTTPS image or video URL in the creative field."); }
}
function responseId(value: Record<string, unknown>): string {
  if (typeof value.id !== "string" || !/^[\w.-]{1,200}$/.test(value.id)) throw new MetaError("Meta did not return a valid post reference.", 502);
  return value.id;
}
async function instagramPermalink(config: MetaConfig, id: string, accessToken: string): Promise<string> {
  const value = await graphJson(config, id, { fields: "permalink", access_token: accessToken }, "GET", "instagram_permalink");
  if (typeof value.permalink !== "string" || !value.permalink.startsWith("https://www.instagram.com/")) throw new MetaError("Meta published the Instagram post but did not return its link.", 502);
  return value.permalink;
}
export async function publishMetaContent(config: MetaConfig, input: MetaPublishInput): Promise<{ url: string; postId: string; pageName: string }> {
  const token = await session(config);
  if (!token) throw new MetaError("Connect Meta to Signal before publishing.", 401, true);
  const page = await publishingPage(config, token);
  if (input.platform === "Facebook") {
    const posted = await graphJson(config, `${page.id}/feed`, { message: input.caption, ...(input.assetUrl ? { link: input.assetUrl } : {}), access_token: page.accessToken }, "POST", "facebook_publish");
    const id = responseId(posted);
    const details = await graphJson(config, id, { fields: "permalink_url", access_token: page.accessToken }, "GET", "facebook_permalink");
    const url = typeof details.permalink_url === "string" && details.permalink_url.startsWith("https://") ? details.permalink_url : `https://www.facebook.com/${id}`;
    return { url, postId: id, pageName: page.name };
  }
  if (!page.instagram || page.instagram.username.toLowerCase() !== "eric_sdesigns") throw new MetaError("The @eric_sdesigns Instagram account is not linked to the Eric's Designs Page returned by Meta.", 403);
  if (input.type === "Carousel") throw new MetaError("Carousel publishing is not enabled yet. Choose Static or Reel.");
  if (!input.assetUrl) throw new MetaError("Add a public HTTPS image or video link before publishing to Instagram.");
  const common = { caption: input.caption, access_token: page.accessToken };
  const media = input.type === "Reel" || input.type === "Video"
    ? { ...common, video_url: httpsAsset(input.assetUrl), media_type: input.type === "Reel" ? "REELS" : "VIDEO", ...(input.type === "Reel" ? { share_to_feed: "true" } : {}) }
    : { ...common, image_url: httpsAsset(input.assetUrl) };
  const container = responseId(await graphJson(config, `${page.instagram.id}/media`, media, "POST", "instagram_media_create"));
  if (input.type === "Reel" || input.type === "Video") {
    let ready = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const status = await graphJson(config, container, { fields: "status_code", access_token: page.accessToken }, "GET", "instagram_media_status");
      if (status.status_code === "FINISHED") { ready = true; break; }
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") throw new MetaError("Instagram could not process the video. Check the creative format and try again.");
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!ready) throw new MetaError("Instagram is still processing the video. The draft container was not published; try again later.", 504);
  }
  const published = await graphJson(config, `${page.instagram.id}/media_publish`, { creation_id: container, access_token: page.accessToken }, "POST", "instagram_media_publish");
  const id = responseId(published);
  return { url: await instagramPermalink(config, id, page.accessToken), postId: id, pageName: `${page.name} · @${page.instagram.username}` };
}
export type MetaDailyInsight = { date: string; platform: "Facebook" | "Instagram"; reach: number; engagements: number; followers: number };
export type MetaAdAccount = { id: string; accountId: string; name: string; currency: string; timezone: string; status: number };
export type MetaAdCampaign = { id: string; name: string; status: string; effectiveStatus: string; objective: string; spend: number; impressions: number; reach: number; clicks: number; ctr: number; cpc: number; cpm: number };
export type MetaInboxMessage = { id: string; text: string; sender: string; createdAt: string };
export type MetaInboxConversation = { id: string; platform: "Facebook" | "Instagram"; participant: string; participantId?: string; updatedAt: string; messages: MetaInboxMessage[] };
const numberField = (value: unknown): number => { const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : 0; };
function safeRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 5000) throw new MetaError("Meta returned an invalid Ads Manager report.", 502);
  return value.filter(validObject);
}
export async function fetchMetaAdAccounts(config: MetaConfig): Promise<MetaAdAccount[]> {
  const token = await session(config);
  if (!token) throw new MetaError("Connect Meta to Signal before opening Ads Manager.", 401, true);
  const response = await graphJson(config, "me/adaccounts", { fields: "id,account_id,name,currency,timezone_name,account_status", limit: "100", access_token: token.accessToken }, "GET", "ad_accounts");
  return safeRows(response.data).flatMap(row => {
    if (typeof row.id !== "string" || !/^act_\d{1,30}$/.test(row.id) || typeof row.account_id !== "string" || !/^\d{1,30}$/.test(row.account_id)) return [];
    return [{ id: row.id, accountId: row.account_id, name: typeof row.name === "string" ? row.name.slice(0, 200) : `Ad account ${row.account_id}`, currency: typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : "USD", timezone: typeof row.timezone_name === "string" ? row.timezone_name.slice(0, 100) : "", status: numberField(row.account_status) }];
  });
}
export async function fetchMetaInbox(config: MetaConfig, pageId: string, platform: "messenger" | "instagram", conversationId?: string): Promise<{ page: { id: string; name: string }; conversations: MetaInboxConversation[] }> {
  if (!/^\d{1,40}$/.test(pageId) || (conversationId && !/^\d{1,60}$/.test(conversationId))) throw new MetaError("Choose a valid Page and conversation.");
  const token = await session(config);
  if (!token) throw new MetaError("Connect Meta to Signal before opening Inbox.", 401, true);
  const pages = await graphJson(config, "me/accounts", { fields: "id,name,access_token,tasks,instagram_business_account{id}", limit: "100", access_token: token.accessToken }, "GET", "inbox_pages");
  if (!Array.isArray(pages.data) || pages.data.length > 500) throw new MetaError("Meta returned an invalid Page list.", 502);
  const page = pages.data.find(value => validObject(value) && value.id === pageId && typeof value.name === "string" && typeof value.access_token === "string" && Array.isArray(value.tasks) && value.tasks.some(task => task === "MESSAGING" || task === "MODERATE"));
  if (!validObject(page) || typeof page.access_token !== "string" || typeof page.name !== "string") throw new MetaError("This Page is not available for messaging. Check that your Meta profile has Page messaging access.", 403);
  const accessToken = page.access_token;
  if (conversationId) {
    const result = await graphJson(config, conversationId, { fields: "id,updated_time,participants,messages.limit(25){id,message,from,created_time}", access_token: accessToken }, "GET", "inbox_messages");
    const participants = validObject(result.participants) && Array.isArray(result.participants.data) ? result.participants.data : [];
    const messageRows = validObject(result.messages) && Array.isArray(result.messages.data) ? result.messages.data : [];
    const messages = messageRows.slice(0, 25).flatMap(item => {
      if (!validObject(item) || typeof item.id !== "string") return [];
      const from = validObject(item.from) && typeof item.from.name === "string" ? item.from.name.slice(0, 120) : "Participant";
      return [{ id: item.id, text: typeof item.message === "string" ? item.message.slice(0, 5000) : "(This message has no text preview)", sender: from, createdAt: typeof item.created_time === "string" ? item.created_time : "" }];
    }).reverse();
    const participant = participants.find(value => validObject(value) && typeof value.id === "string" && value.id !== pageId);
    return { page: { id: pageId, name: page.name }, conversations: [{ id: conversationId, platform: platform === "instagram" ? "Instagram" : "Facebook", participant: validObject(participant) && typeof participant.name === "string" ? participant.name.slice(0, 120) : "Conversation", ...(validObject(participant) && typeof participant.id === "string" ? { participantId: participant.id } : {}), updatedAt: typeof result.updated_time === "string" ? result.updated_time : "", messages }] };
  }
  const result = await graphJson(config, `${pageId}/conversations`, { platform, fields: "id,updated_time,participants", limit: "50", access_token: accessToken }, "GET", "inbox_conversations");
  const conversations = safeRows(result.data).flatMap(item => {
    if (typeof item.id !== "string" || !/^\d{1,60}$/.test(item.id)) return [];
    const participants = validObject(item.participants) && Array.isArray(item.participants.data) ? item.participants.data : [];
    const participant = participants.find(value => validObject(value) && typeof value.id === "string" && value.id !== pageId);
    return [{ id: item.id, platform: platform === "instagram" ? "Instagram" as const : "Facebook" as const, participant: validObject(participant) && typeof participant.name === "string" ? participant.name.slice(0, 120) : "Conversation", ...(validObject(participant) && typeof participant.id === "string" ? { participantId: participant.id } : {}), updatedAt: typeof item.updated_time === "string" ? item.updated_time : "", messages: [] }];
  });
  return { page: { id: pageId, name: page.name }, conversations };
}
export async function replyMetaInbox(config: MetaConfig, input: { pageId: string; platform: "messenger" | "instagram"; conversationId: string; text: string }): Promise<void> {
  const message = input.text.trim();
  if (!/^\d{1,40}$/.test(input.pageId) || !/^\d{1,60}$/.test(input.conversationId) || message.length < 1 || message.length > 2000) throw new MetaError("Enter a valid conversation reply.");
  const token = await session(config);
  if (!token) throw new MetaError("Connect Meta to Signal before replying.", 401, true);
  const pages = await graphJson(config, "me/accounts", { fields: "id,name,access_token,tasks,instagram_business_account{id}", limit: "100", access_token: token.accessToken }, "GET", "inbox_pages");
  if (!Array.isArray(pages.data) || pages.data.length > 500) throw new MetaError("Meta returned an invalid Page list.", 502);
  const page = pages.data.find(value => validObject(value) && value.id === input.pageId && typeof value.access_token === "string" && Array.isArray(value.tasks) && value.tasks.includes("MESSAGING"));
  if (!validObject(page) || typeof page.access_token !== "string") throw new MetaError("This Page does not grant Signal messaging access.", 403);
  const thread = await graphJson(config, input.conversationId, { fields: "id,participants", access_token: page.access_token }, "GET", "inbox_reply_recipient");
  const participants = validObject(thread.participants) && Array.isArray(thread.participants.data) ? thread.participants.data : [];
  const recipient = participants.find(value => validObject(value) && typeof value.id === "string" && value.id !== input.pageId);
  if (!validObject(recipient) || typeof recipient.id !== "string") throw new MetaError("Meta did not return a reply recipient for this conversation.", 400);
  const instagram = validObject(page.instagram_business_account) && typeof page.instagram_business_account.id === "string" ? page.instagram_business_account.id : undefined;
  const senderId = input.platform === "instagram" ? instagram : input.pageId;
  if (!senderId) throw new MetaError("This Page does not have a linked Instagram professional account for messaging.", 403);
  const result = await graphJson(config, `${senderId}/messages`, { recipient: JSON.stringify({ id: recipient.id }), message: JSON.stringify({ text: message }), ...(input.platform === "messenger" ? { messaging_type: "RESPONSE" } : {}), access_token: page.access_token }, "POST", "inbox_reply");
  if (typeof result.message_id !== "string" && typeof result.recipient_id !== "string") throw new MetaError("Meta did not confirm that the reply was sent.", 502);
}
export async function fetchMetaAdCampaigns(config: MetaConfig, accountId: string, datePreset: "last_7d" | "last_30d" | "last_90d"): Promise<MetaAdCampaign[]> {
  if (!/^act_\d{1,30}$/.test(accountId)) throw new MetaError("Choose a valid Meta ad account.");
  const token = await session(config);
  if (!token) throw new MetaError("Connect Meta to Signal before opening Ads Manager.", 401, true);
  const accounts = await fetchMetaAdAccounts(config);
  if (!accounts.some(account => account.id === accountId)) throw new MetaError("That ad account is not available to the connected Meta profile.", 403);
  const [campaignResponse, insightResponse] = await Promise.all([
    graphJson(config, `${accountId}/campaigns`, { fields: "id,name,status,effective_status,objective", limit: "100", access_token: token.accessToken }, "GET", "ad_campaigns"),
    graphJson(config, `${accountId}/insights`, { level: "campaign", date_preset: datePreset, fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm", limit: "100", access_token: token.accessToken }, "GET", "ad_insights"),
  ]);
  const stats = new Map(safeRows(insightResponse.data).flatMap(row => typeof row.campaign_id === "string" ? [[row.campaign_id, row] as const] : []));
  return safeRows(campaignResponse.data).flatMap(row => {
    if (typeof row.id !== "string" || !/^\d{1,40}$/.test(row.id)) return [];
    const insight = stats.get(row.id);
    return [{ id: row.id, name: typeof row.name === "string" ? row.name.slice(0, 250) : "Untitled campaign", status: typeof row.status === "string" ? row.status : "UNKNOWN", effectiveStatus: typeof row.effective_status === "string" ? row.effective_status : "UNKNOWN", objective: typeof row.objective === "string" ? row.objective : "—", spend: numberField(insight?.spend), impressions: numberField(insight?.impressions), reach: numberField(insight?.reach), clicks: numberField(insight?.clicks), ctr: numberField(insight?.ctr), cpc: numberField(insight?.cpc), cpm: numberField(insight?.cpm) }];
  });
}
export async function manageMetaCampaign(config: MetaConfig, input: { accountId: string; campaignId?: string; name: string; objective?: string; status?: "ACTIVE" | "PAUSED" }): Promise<{ id: string }> {
  if (!/^act_\d{1,30}$/.test(input.accountId) || input.name.trim().length < 2 || input.name.trim().length > 200) throw new MetaError("Enter a valid ad account and campaign name.");
  const token = await session(config);
  if (!token) throw new MetaError("Connect Meta to Signal before managing campaigns.", 401, true);
  if (!(await fetchMetaAdAccounts(config)).some(account => account.id === input.accountId)) throw new MetaError("That ad account is not available to the connected Meta profile.", 403);
  if (input.campaignId) {
    if (!/^\d{1,40}$/.test(input.campaignId) || !input.status) throw new MetaError("Choose a valid campaign and delivery status.");
    const campaigns = await fetchMetaAdCampaigns(config, input.accountId, "last_7d");
    if (!campaigns.some(campaign => campaign.id === input.campaignId)) throw new MetaError("That campaign does not belong to this ad account.", 403);
    const result = await graphJson(config, input.campaignId, { name: input.name.trim(), status: input.status, access_token: token.accessToken }, "POST", "campaign_update");
    if (result.success !== true) throw new MetaError("Meta did not confirm the campaign update.", 502);
    return { id: input.campaignId };
  }
  const objectives = new Set(["OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_APP_PROMOTION"]);
  if (!input.objective || !objectives.has(input.objective)) throw new MetaError("Choose a supported campaign objective.");
  const result = await graphJson(config, `${input.accountId}/campaigns`, { name: input.name.trim(), objective: input.objective, status: "PAUSED", special_ad_categories: "[]", access_token: token.accessToken }, "POST", "campaign_create");
  if (typeof result.id !== "string" || !/^\d{1,40}$/.test(result.id)) throw new MetaError("Meta did not return a valid campaign reference.", 502);
  return { id: result.id };
}
export type MetaInsightsReport = { page: { id: string; name: string; link: string; instagramUsername?: string }; metrics: MetaDailyInsight[] };
function insightRows(value: Record<string, unknown>): Map<string, number> {
  const result = new Map<string, number>();
  if (!Array.isArray(value.data) || value.data.length > 100) throw new MetaError("Meta returned an invalid insights report.", 502);
  for (const item of value.data) {
    if (!validObject(item) || !Array.isArray(item.values) || item.values.length > 100) continue;
    const name = typeof item.name === "string" ? item.name : "";
    for (const row of item.values) {
      if (!validObject(row) || typeof row.end_time !== "string") continue;
      const date = row.end_time.slice(0, 10);
      const raw = typeof row.value === "number" ? row.value : validObject(row.value) ? Number.NaN : Number(row.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(raw) || raw < 0) continue;
      result.set(`${date}|${name}`, Math.min(Number.MAX_SAFE_INTEGER, Math.round(raw)));
    }
  }
  return result;
}
export async function fetchMetaInsights(config: MetaConfig, from: string, to: string): Promise<MetaInsightsReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 90 * 86400000) throw new MetaError("Choose an insights period of up to 90 days.");
  const token = await session(config);
  if (!token) throw new MetaError("Connect Meta to Signal before syncing insights.", 401, true);
  const page = await publishingPage(config, token);
  const query = { period: "day", since: from, until: to, access_token: page.accessToken };
  const [facebookRaw, instagramRaw] = await Promise.all([
    graphJson(config, `${page.id}/insights`, { ...query, metric: "page_total_media_view_unique,page_post_engagements,page_follows" }, "GET", "facebook_insights"),
    page.instagram?.username.toLowerCase() === "eric_sdesigns"
      ? graphJson(config, `${page.instagram.id}/insights`, { ...query, metric: "reach", metric_type: "time_series" }, "GET", "instagram_insights")
      : Promise.resolve(undefined),
  ]);
  const facebook = insightRows(facebookRaw), instagram = instagramRaw ? insightRows(instagramRaw) : new Map<string, number>();
  const output: MetaDailyInsight[] = [];
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const value = (data: Map<string, number>, names: string[]) => names.map(name => data.get(`${day}|${name}`)).find(metric => metric !== undefined) ?? 0;
    const fb = { date: day, platform: "Facebook" as const, reach: value(facebook, ["page_total_media_view_unique"]), engagements: value(facebook, ["page_post_engagements"]), followers: value(facebook, ["page_follows"]) };
    const ig = { date: day, platform: "Instagram" as const, reach: value(instagram, ["reach"]), engagements: 0, followers: 0 };
    if (fb.reach || fb.engagements || fb.followers) output.push(fb);
    if (instagramRaw && (ig.reach || ig.engagements || ig.followers)) output.push(ig);
  }
  return { page: { id: page.id, name: page.name, link: page.link ?? `https://www.facebook.com/${page.id}`, ...(page.instagram ? { instagramUsername: page.instagram.username } : {}) }, metrics: output };
}
export async function metaStatus(config: MetaConfig) {
  const jar = await cookies(); const raw = jar.get(await scopedCookieName(TOKEN_COOKIE))?.value; const browser = raw ? decryptMeta<MetaToken>(raw, config.key) : undefined;
  try {
    const token = await session(config); if (!token) return { connected: false, pages: [] as MetaPage[] };
    return { connected: true, ...(token.expiresAt === null ? {} : { expiresAt: token.expiresAt }), pages: await managedPages(config, token) };
  } catch (error) {
    if (error instanceof MetaError) return { connected: validToken(browser) && !error.reconnectNeeded, pages: [] as MetaPage[], error: error.message, reconnectNeeded: error.reconnectNeeded };
    throw error;
  }
}
export async function disconnectMeta(config: MetaConfig): Promise<void> {
  const jar = await cookies();
  const tokenCookie = await scopedCookieName(TOKEN_COOKIE); const stateCookie = await scopedCookieName(STATE_COOKIE);
  try {
    const token = await session(config);
    if (token) { await graphJson(config, "me/permissions", { access_token: token.accessToken }, "DELETE").catch(() => {}); }
  } finally { await clearVault(); jar.delete(tokenCookie); jar.delete(stateCookie); }
}
export function metaJson(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
export function metaErrorResponse(error: unknown): Response { return metaJson({ error: error instanceof MetaError ? error.message : "Meta could not complete the request. Try again." }, error instanceof MetaError ? error.status : 500); }
