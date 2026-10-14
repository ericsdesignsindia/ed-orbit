import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { mkdir, readFile, rename, unlink, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { currentTenantId } from "./tenant";

const TOKEN_COOKIE = "seo_google_tokens";
const STATE_COOKIE = "seo_google_state";
const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/analytics.readonly"];
const MAX_SESSION_SECONDS = 30 * 24 * 60 * 60;
async function scopedCookieName(base: string, tenantId?: string) {
  const id = tenantId ?? await currentTenantId();
  return id === "legacy" ? base : `${base}_${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
}
type Environment = Record<string, string | undefined>;
export type GoogleConfig = { clientId: string; clientSecret: string; baseUrl: string; key: string };
export type Tokens = { kind: "tokens"; accessToken: string; refreshToken?: string; expiresAt: number; sessionExpiresAt: number; scopes?: string[]; sessionId?: string };
type OAuthState = { kind: "state"; state: string; verifier: string; expiresAt: number; scopes?: string[]; tenantId?: string };
export type GoogleServices = { gsc: boolean; ga4: boolean };
export type Properties = { gsc: { siteUrl: string; permissionLevel: string }[]; ga4: { id: string; name: string }[]; errors?: string[]; retryable?: boolean; reconnectNeeded?: boolean };
export class GoogleError extends Error {
  constructor(message: string, public status = 400, public retryable = false, public reconnectNeeded = false) { super(message); }
}

const vaultPath = () => path.join(process.env.ORBIT_DATA_DIR || path.join(process.cwd(), ".data"), "google-session.enc");
// Serialize refresh/disconnect/OAuth persistence in this single local server process.
let sessionQueue: Promise<unknown> = Promise.resolve();
function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = sessionQueue.then(operation, operation);
  sessionQueue = result.catch(() => {});
  return result;
}
export async function writeGoogleVault(tokens: Tokens, key: string, destination = vaultPath()): Promise<void> {
  if (process.env.VERCEL === "1" && destination === vaultPath()) {
    const { writeHostedGoogleVault } = await import("./neon-vault");
    await writeHostedGoogleVault(encryptCookie(tokens, key));
    return;
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, encryptCookie(tokens, key), { mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function readGoogleVault(key: string, destination = vaultPath()): Promise<Tokens | undefined> {
  if (process.env.VERCEL === "1" && destination === vaultPath()) {
    try {
      const { readHostedGoogleVault } = await import("./neon-vault");
      const encrypted = await readHostedGoogleVault();
      if (!encrypted) return undefined;
      const tokens = decryptCookie<Tokens>(encrypted, key);
      return validTokens(tokens) ? tokens : undefined;
    } catch (error) { if (error instanceof GoogleError) throw error; throw new GoogleError("The hosted Google session could not be read.", 503, true); }
  }
  try { const tokens = decryptCookie<Tokens>(await readFile(destination, "utf8"), key); return validTokens(tokens) ? tokens : undefined; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new GoogleError("The local Google session could not be read.", 503, true); }
}
export async function clearGoogleVault(destination = vaultPath()): Promise<void> {
  if (process.env.VERCEL === "1" && destination === vaultPath()) {
    const { clearHostedGoogleVault } = await import("./neon-vault");
    await clearHostedGoogleVault();
    return;
  }
  try { await unlink(destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new GoogleError("The local Google session could not be cleared.", 503, true); }
}
function validTokens(tokens: Tokens | undefined): tokens is Tokens {
  return !!tokens && tokens.kind === "tokens" && typeof tokens.accessToken === "string" && !!tokens.accessToken && Number.isFinite(tokens.expiresAt) && Number.isFinite(tokens.sessionExpiresAt) && tokens.sessionExpiresAt > Date.now();
}
export function tokenServices(tokens: Tokens): GoogleServices {
  const scopes = tokens.scopes ?? SCOPES; // Legacy cookies required both grants.
  return { gsc: scopes.includes(SCOPES[0]), ga4: scopes.includes(SCOPES[1]) };
}

export function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname.toLowerCase());
}

export function readGoogleConfig(env: Environment = process.env): { config?: GoogleConfig; missing: string[] } {
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID?.trim()) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) missing.push("GOOGLE_CLIENT_SECRET");
  if (!/^[a-f\d]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY ?? "")) missing.push("TOKEN_ENCRYPTION_KEY");
  const baseUrl = env.APP_BASE_URL ?? (env.VERCEL === "1" ? "https://seo-command-center-six.vercel.app" : "http://localhost:3000");
  try {
    const url = new URL(baseUrl);
    const local = env.VERCEL !== "1" && isLoopbackHostname(url.hostname) && ["http:", "https:"].includes(url.protocol);
    const hosted = env.VERCEL === "1" && url.protocol === "https:" && !isLoopbackHostname(url.hostname);
    if ((!local && !hosted) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
  } catch { missing.push("APP_BASE_URL"); }
  if (missing.length) return { missing };
  return { missing, config: { clientId: env.GOOGLE_CLIENT_ID!.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(), baseUrl: new URL(baseUrl).origin, key: env.TOKEN_ENCRYPTION_KEY! } };
}

export function requireConfig(): GoogleConfig {
  const { config, missing } = readGoogleConfig();
  if (!config) throw new GoogleError(`Google configuration is missing or invalid: ${missing.join(", ")}.`, 503);
  return config;
}

/** Reject DNS rebinding and browser cross-origin requests, including read endpoints. */
export function localRequestOrigin(request: Request): string {
  const protocol = new URL(request.url).protocol;
  const host = request.headers.get("host");
  if (!host || !["http:", "https:"].includes(protocol)) throw new GoogleError("Google integration is available only on the local app host.", 403);
  let origin: URL;
  try { origin = new URL(`${protocol}//${host}`); } catch { throw new GoogleError("Invalid local host.", 403); }
  const validHost = process.env.VERCEL === "1" ? protocol === "https:" && !isLoopbackHostname(origin.hostname) : isLoopbackHostname(origin.hostname);
  if (!validHost || origin.host.toLowerCase() !== host.toLowerCase() || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new GoogleError("Google integration is unavailable on this host.", 403);
  return origin.origin;
}

export function assertLocalRequest(request: Request, mutation = false): void {
  const url = new URL(request.url);
  // Next may construct request.url with its bound hostname instead of the browser Host.
  const localOrigin = localRequestOrigin(request);
  const origin = request.headers.get("origin");
  if ((origin && origin !== localOrigin) || (mutation && origin !== localOrigin)) throw new GoogleError("A same-origin request is required.", 403);
  const fetchSite = request.headers.get("sec-fetch-site");
  // OAuth callbacks and canonical-host login navigations are top-level GETs.
  const loginNavigation = url.pathname === "/api/google/connect" && request.method === "GET" && request.headers.get("sec-fetch-mode") === "navigate" && request.headers.get("sec-fetch-dest") === "document";
  if (fetchSite === "cross-site" && url.pathname !== "/api/google/callback" && !loginNavigation) throw new GoogleError("Cross-site requests are not allowed.", 403);
}

export function encryptCookie(value: unknown, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from("seo-command-center:google:v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptCookie<T>(value: string, key: string): T | undefined {
  try {
    if (value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length < 29) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from("seo-command-center:google:v1"));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { return undefined; }
}

function cookieOptions(config: GoogleConfig, maxAge: number) {
  return { httpOnly: true, secure: config.baseUrl.startsWith("https:"), sameSite: "lax" as const, path: "/", maxAge };
}

async function saveTokens(tokens: Tokens, config: GoogleConfig): Promise<void> {
  const encoded = encryptCookie(tokens, config.key);
  if (encoded.length > 3800) throw new GoogleError("Google credentials exceed the supported cookie size. Reconnect your account.", 502);
  await writeGoogleVault(tokens, config.key);
  (await cookies()).set(await scopedCookieName(TOKEN_COOKIE), encoded, cookieOptions(config, Math.max(0, Math.floor((tokens.sessionExpiresAt - Date.now()) / 1000))));
}

export async function clearGoogleCookies(): Promise<void> {
  await withSessionLock(() => clearGoogleVault());
  const jar = await cookies();
  jar.delete(await scopedCookieName(TOKEN_COOKIE));
  jar.delete(await scopedCookieName(STATE_COOKIE));
}

/** Bounded transport; upstream bodies and credentials never become public errors. */
export async function fetchGoogleJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      // Only inspect a bounded OAuth error code; never propagate an upstream body.
      let revoked = response.status === 401;
      if (url === "https://oauth2.googleapis.com/token" && response.status === 400) {
        const reader = response.body?.getReader();
        if (reader) {
          const chunks: Uint8Array[] = []; let size = 0;
          while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); break; } chunks.push(value); }
          if (size <= 8192) { try { revoked = JSON.parse(Buffer.concat(chunks).toString()).error === "invalid_grant"; } catch {} }
        }
      } else await response.body?.cancel();
      const retryable = response.status === 429 || response.status >= 500 || response.status === 408;
      throw new GoogleError(revoked ? "Google authorization expired or was revoked. Reconnect your account." : response.status === 403 ? "Google denied access. Check property permissions and enabled Google APIs." : response.status === 429 ? "Google rate limit reached. Try again later." : "Google could not complete the request. Try again later.", revoked ? 401 : 502, retryable, revoked);
    }
    if (Number(response.headers.get("content-length")) > 2_000_000) { await response.body?.cancel(); throw new GoogleError("Google returned too much data.", 502); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new GoogleError("Google returned too much data.", 502); }
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof GoogleError) throw error;
    throw new GoogleError("Google is unavailable or returned an invalid response. Try again.", 502, true);
  }
}

export function parseTokens(data: Record<string, unknown>, previous?: Tokens, requestedScopes = SCOPES): Tokens {
  if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 2048 || typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400 || (data.refresh_token !== undefined && (typeof data.refresh_token !== "string" || !data.refresh_token || data.refresh_token.length > 2048))) throw new GoogleError("Google returned invalid credentials. Reconnect your account.", 502);
  const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(scope => SCOPES.includes(scope)) : previous?.scopes ?? requestedScopes;
  if (!scopes.length) throw new GoogleError("Grant Search Console or Analytics read-only permission.", 403);
  return { kind: "tokens", accessToken: data.access_token, refreshToken: data.refresh_token as string | undefined ?? previous?.refreshToken, scopes, sessionId: previous?.sessionId ?? randomBytes(24).toString("hex"), expiresAt: Date.now() + data.expires_in * 1000, sessionExpiresAt: previous?.sessionExpiresAt ?? Date.now() + MAX_SESSION_SECONDS * 1000 };
}

export async function refreshGoogleTokens(tokens: Tokens, config: GoogleConfig): Promise<Tokens> {
  if (tokens.expiresAt > Date.now() + 60_000) return tokens;
  if (!tokens.refreshToken) throw new GoogleError("Google session needs reconnection.", 401, false, true);
  const data = await fetchGoogleJson("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: tokens.refreshToken, grant_type: "refresh_token" }) });
  return parseTokens(data, tokens);
}

export async function getGoogleSession(config: GoogleConfig): Promise<Tokens | undefined> {
  return withSessionLock(() => authenticatedSession(config));
}
async function authenticatedSession(config: GoogleConfig): Promise<Tokens | undefined> {
  const jar = await cookies();
  const tokenCookie = await scopedCookieName(TOKEN_COOKIE);
  const raw = jar.get(tokenCookie)?.value;
  const cookie = raw ? decryptCookie<Tokens>(raw, config.key) : undefined;
  if (!validTokens(cookie)) { if (raw) jar.delete(tokenCookie); return undefined; }
  const stored = await readGoogleVault(config.key);
  if (!stored && cookie.sessionId) { jar.delete(tokenCookie); throw new GoogleError("The local Google session ended. Connect again.", 401, false, true); }
  if (stored && (cookie.sessionId ? stored.sessionId !== cookie.sessionId : stored.accessToken !== cookie.accessToken && (!cookie.refreshToken || stored.refreshToken !== cookie.refreshToken))) {
    jar.delete(tokenCookie);
    throw new GoogleError("The Google account changed. Connect again in this browser.", 401, false, true);
  }
  // The cookie is the authorization boundary; the vault never authenticates a visitor.
  const tokens = stored ?? { ...cookie, sessionId: randomBytes(24).toString("hex") };
  try {
    const refreshed = await refreshGoogleTokens(tokens, config);
    if (!stored || refreshed !== tokens || refreshed.accessToken !== cookie.accessToken) await saveTokens(refreshed, config);
    return refreshed;
  } catch (error) {
    if (error instanceof GoogleError && error.reconnectNeeded) { jar.delete(tokenCookie); if (!stored || stored.sessionId === cookie.sessionId) await clearGoogleVault(); }
    throw error;
  }
}

export async function getGoogleAccessToken(config: GoogleConfig): Promise<string | undefined> {
  return (await getGoogleSession(config))?.accessToken;
}

export async function googleStatus(config: GoogleConfig) {
  const raw = (await cookies()).get(await scopedCookieName(TOKEN_COOKIE))?.value;
  const existing = raw ? decryptCookie<Tokens>(raw, config.key) : undefined;
  try { const tokens = await getGoogleSession(config); return { connected: !!tokens, services: tokens ? tokenServices(tokens) : { gsc: false, ga4: false } }; }
  catch (error) { if (error instanceof GoogleError) return { connected: validTokens(existing) && !error.reconnectNeeded, services: validTokens(existing) && !error.reconnectNeeded ? tokenServices(existing) : { gsc: false, ga4: false }, retryable: error.retryable, reconnectNeeded: error.reconnectNeeded }; throw error; }
}

export async function requireAccessToken(): Promise<string> {
  const token = await getGoogleAccessToken(requireConfig());
  if (!token) throw new GoogleError("Google is not connected or the session expired. Connect your Google account again.", 401, false, true);
  return token;
}

export async function startGoogleOAuth(config: GoogleConfig, service: string = "both", tenantId?: string): Promise<string> {
  if (!["gsc", "ga4", "both"].includes(service)) throw new GoogleError("Choose gsc, ga4, or both.");
  const scopes = service === "both" ? SCOPES : [SCOPES[service === "gsc" ? 0 : 1]];
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  (await cookies()).set(await scopedCookieName(STATE_COOKIE, tenantId), encryptCookie({ kind: "state", state, verifier, scopes, tenantId, expiresAt: Date.now() + 600_000 } satisfies OAuthState, config.key), cookieOptions(config, 600));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.baseUrl}/api/google/callback`, response_type: "code", scope: scopes.join(" "), include_granted_scopes: "true", access_type: "offline", prompt: "consent", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return url.toString();
}

export async function finishGoogleOAuth(request: Request, config: GoogleConfig, tenantId?: string): Promise<void> {
  const jar = await cookies();
  const stateCookie = await scopedCookieName(STATE_COOKIE, tenantId);
  const raw = jar.get(stateCookie)?.value;
  jar.delete(stateCookie);
  const state = raw ? decryptCookie<OAuthState>(raw, config.key) : undefined;
  const url = new URL(request.url);
  const received = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (localRequestOrigin(request) !== config.baseUrl || !state || state.kind !== "state" || (tenantId !== undefined && state.tenantId !== tenantId) || typeof state.state !== "string" || typeof state.verifier !== "string" || !Number.isFinite(state.expiresAt) || state.expiresAt <= Date.now() || Buffer.byteLength(received) !== Buffer.byteLength(state.state) || !timingSafeEqual(Buffer.from(received), Buffer.from(state.state)) || !code || code.length > 4096 || url.searchParams.has("error")) throw new GoogleError("Google authorization could not be completed.");
  const data = await fetchGoogleJson("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: `${config.baseUrl}/api/google/callback`, grant_type: "authorization_code", code_verifier: state.verifier }) });
  await withSessionLock(() => saveTokens(parseTokens(data, undefined, state.scopes), config));
}

export function validatePropertyId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:properties\/)?[0-9]{1,30}$/.test(value)) throw new GoogleError("Choose a valid numeric GA4 property ID.");
  return value.replace(/^properties\//, "");
}

export function validateSiteUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new GoogleError("Choose a valid Search Console site URL.");
  if (/^sc-domain:(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash || url.search || /[\s\\]/.test(value)) throw new Error();
    return value;
  } catch { throw new GoogleError("Choose a valid http(s) URL-prefix or sc-domain Search Console property."); }
}

export function reportDates(days: unknown, now = new Date()): { startDate: string; endDate: string } {
  if (days !== 7 && days !== 30 && days !== 90) throw new GoogleError("Report days must be 7, 30, or 90.");
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function numeric(value: unknown): number { const number = typeof value === "string" || typeof value === "number" ? Number(value) : NaN; if (!Number.isFinite(number) || number < 0) throw new GoogleError("Google returned invalid report metrics.", 502); return number; }
function publicError(error: unknown): string { return error instanceof GoogleError ? error.message : "Google could not complete this request."; }
async function sourceError(source: string, error: unknown): Promise<string> {
  return `${source}: ${publicError(error)}`;
}

export async function googleProperties(token: string, services: GoogleServices = { gsc: true, ga4: true }): Promise<Properties> {
  const result: Properties = { gsc: [], ga4: [] };
  const errors: string[] = [];
  const recordError = async (source: string, error: unknown) => {
    errors.push(await sourceError(source, error));
    if (error instanceof GoogleError) { if (error.retryable) result.retryable = true; if (error.reconnectNeeded) result.reconnectNeeded = true; }
  };
  const headers = { Authorization: `Bearer ${token}` };
  await Promise.all([
    (async () => {
      if (!services.gsc) return;
      try {
        const data = await fetchGoogleJson("https://www.googleapis.com/webmasters/v3/sites", { headers });
        result.gsc = list(data.siteEntry).flatMap(entry => { const item = object(entry); return typeof item.siteUrl === "string" && typeof item.permissionLevel === "string" ? [{ siteUrl: item.siteUrl, permissionLevel: item.permissionLevel }] : []; });
      } catch (error) { await recordError("Search Console", error); }
    })(),
    (async () => {
      if (!services.ga4) return;
      try {
        let pageToken = "";
        for (let page = 0; page < 10; page++) {
          const params = new URLSearchParams({ pageSize: "200" });
          if (pageToken) params.set("pageToken", pageToken);
          const data = await fetchGoogleJson(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${params}`, { headers });
          for (const account of list(data.accountSummaries)) for (const summary of list(object(account).propertySummaries)) {
            const item = object(summary);
            if (typeof item.property === "string" && /^properties\/[0-9]{1,30}$/.test(item.property)) result.ga4.push({ id: item.property.slice(11), name: typeof item.displayName === "string" ? item.displayName : item.property });
          }
          pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
          if (!pageToken) break;
          if (page === 9) errors.push("Analytics: Property list was truncated after 10 pages.");
        }
      } catch (error) { await recordError("Analytics", error); }
    })(),
  ]);
  if (errors.length) result.errors = errors;
  return result;
}

export type SearchInsight = { key: string; clicks: number; impressions: number; ctr: number; position: number; previousClicks: number; clickChangePercent: number | null; currentObserved?: boolean; previousObserved?: boolean };
type SearchTotals = { clicks: number; impressions: number; ctr: number; position: number };
export type GoogleReport = {
  startDate: string; endDate: string;
  properties?: { siteUrl?: string; propertyId?: string };
  gsc?: SearchTotals & { rows: { date: string; clicks: number; impressions: number }[] };
  ga4?: { users: number; sessions: number; pageViews: number; trafficScope: "organic-search"; keyEvents?: number };
  queries?: SearchInsight[]; pages?: SearchInsight[];
  comparison?: { startDate: string; endDate: string; previous: SearchTotals; changes: { clicksPercent: number | null; impressionsPercent: number | null } };
  opportunities?: { id: string; type: "low-ctr" | "content-decay"; title: string; detail: string; url?: string }[];
  limitations?: string[]; errors?: string[]; retryable?: boolean; reconnectNeeded?: boolean;
};

export function percentChange(current: number, previous: number): number | null { return previous === 0 ? null : (current - previous) / previous * 100; }
function searchRows(data: Record<string, unknown>): Record<string, unknown>[] {
  // Search Console uses {} for a legitimately empty result.
  if (data.rows !== undefined && !Array.isArray(data.rows)) throw new GoogleError("Google returned invalid Search Console rows.", 502);
  return list(data.rows).map(object);
}
function searchTotals(rows: Record<string, unknown>[]): SearchTotals {
  let clicks = 0, impressions = 0, weightedPosition = 0;
  for (const row of rows) { const count = numeric(row.impressions); clicks += numeric(row.clicks); impressions += count; weightedPosition += numeric(row.position) * count; }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? weightedPosition / impressions : 0 };
}
export function mergeSearchInsights(current: Record<string, unknown>[], previous: Record<string, unknown>[]): SearchInsight[] {
  const unpack = (rows: Record<string, unknown>[]) => new Map(rows.map(row => {
    const key = list(row.keys)[0];
    if (typeof key !== "string" || !key) throw new GoogleError("Google returned invalid Search Console dimensions.", 502);
    return [key, searchTotals([row])] as const;
  }));
  const present = unpack(current), past = unpack(previous);
  return [...new Set([...present.keys(), ...past.keys()])].map(key => {
    const metrics = present.get(key) ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const previousClicks = past.get(key)?.clicks ?? 0;
    return { key, ...metrics, previousClicks, currentObserved: present.has(key), previousObserved: past.has(key), clickChangePercent: present.has(key) && past.has(key) ? percentChange(metrics.clicks, previousClicks) : null };
  }).sort((a, b) => b.clicks - a.clicks || b.previousClicks - a.previousClicks);
}

/** Background-only entry point: HTTP handlers must authenticate their cookie instead. */
export async function fetchStoredGoogleReport(input: unknown): Promise<GoogleReport> {
  const config = requireConfig();
  const tokens = await withSessionLock(() => refreshStoredGoogleSession(config));
  return googleReport(tokens.accessToken, input);
}

/** Server-only helper; destination injection keeps persistence tests isolated. */
export async function refreshStoredGoogleSession(config: GoogleConfig, destination = vaultPath()): Promise<Tokens> {
  const stored = await readGoogleVault(config.key, destination);
  if (!stored) throw new GoogleError("Connect Google locally before running scheduled reports.", 401, false, true);
  try {
    const refreshed = await refreshGoogleTokens(stored, config);
    if (refreshed !== stored) await writeGoogleVault(refreshed, config.key, destination);
    return refreshed;
  } catch (error) { if (error instanceof GoogleError && error.reconnectNeeded) await clearGoogleVault(destination); throw error; }
}

export async function googleReport(token: string, input: unknown, now = new Date()): Promise<GoogleReport> {
  const body = object(input);
  const result: GoogleReport = reportDates(body.days, now);
  const siteUrl = body.siteUrl === undefined ? undefined : validateSiteUrl(body.siteUrl);
  const propertyId = body.propertyId === undefined ? undefined : validatePropertyId(body.propertyId);
  if (!siteUrl && !propertyId) throw new GoogleError("Choose at least one Google property.");
  result.properties = { ...(siteUrl ? { siteUrl } : {}), ...(propertyId ? { propertyId } : {}) };
  result.limitations = [];
  const recordError = async (source: string, error: unknown) => {
    errors.push(await sourceError(source, error));
    if (error instanceof GoogleError) { if (error.retryable) result.retryable = true; if (error.reconnectNeeded) result.reconnectNeeded = true; }
  };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const errors: string[] = [];
  await Promise.all([
    (async () => {
      if (!siteUrl) return;
      try {
        const days = body.days as number;
        const shift = (date: string, offset: number) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
        const previous = { startDate: shift(result.startDate, -days), endDate: shift(result.startDate, -1) };
        const current = { startDate: result.startDate, endDate: result.endDate };
        const query = async (dates: typeof current, dimension: string) => searchRows(await fetchGoogleJson(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: "POST", headers, body: JSON.stringify({ ...dates, dimensions: [dimension], rowLimit: 1000, dataState: "final" }) }));
        // Six GSC requests plus one GA4 request; no pagination or implicit retries.
        const [dateRows, previousDates] = await Promise.all([query(current, "date"), query(previous, "date")]);
        const rows = dateRows.map(row => {
          const date = list(row.keys)[0];
          if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GoogleError("Google returned invalid report dates.", 502);
          return { date, clicks: numeric(row.clicks), impressions: numeric(row.impressions) };
        }).sort((a, b) => a.date.localeCompare(b.date));
        const totals = searchTotals(dateRows), past = searchTotals(previousDates);
        result.gsc = { ...totals, rows };
        result.comparison = { ...previous, previous: past, changes: { clicksPercent: percentChange(totals.clicks, past.clicks), impressionsPercent: percentChange(totals.impressions, past.impressions) } };
        result.limitations!.push("Search Console query and page tables show at most 1,000 top rows per period; anonymized queries and omitted rows mean they are not exhaustive and may not reconcile with totals. Missing prior rows are not proof of zero historical traffic. Search Console dates use Pacific time.");
        try {
          const [queries, priorQueries, pages, priorPages] = await Promise.all([query(current, "query"), query(previous, "query"), query(current, "page"), query(previous, "page")]);
          result.queries = mergeSearchInsights(queries, priorQueries);
          result.pages = mergeSearchInsights(pages, priorPages);
          result.opportunities = [];
          for (const [dimension, insights] of [["query", result.queries], ["page", result.pages]] as const) for (const insight of insights) {
            // Conservative screening, not a ranking or uplift promise. Position is impression weighted.
            const threshold = insight.position <= 3 ? 0.03 : insight.position <= 10 ? 0.01 : 0;
            const url = dimension === "page" && /^https?:\/\//.test(insight.key) ? insight.key : undefined;
            if (insight.impressions >= 100 && insight.position > 0 && insight.ctr < threshold) result.opportunities.push({ id: `low-ctr:${dimension}:${insight.key}`, type: "low-ctr", title: `Review ${dimension}: ${insight.key}`, detail: `${insight.impressions} impressions; ${(insight.ctr * 100).toFixed(1)}% CTR at weighted position ${insight.position.toFixed(1)}. Review intent and snippet; CTR varies by query and SERP layout.`, ...(url ? { url } : {}) });
            if (insight.previousClicks >= 10 && insight.clickChangePercent !== null && insight.clickChangePercent <= -20) result.opportunities.push({ id: `content-decay:${dimension}:${insight.key}`, type: "content-decay", title: `Investigate declining ${dimension}: ${insight.key}`, detail: `Clicks changed ${insight.clickChangePercent.toFixed(1)}% from ${insight.previousClicks}. Check seasonality, row limits, and search intent before changing content.`, ...(url ? { url } : {}) });
          }
          result.opportunities = result.opportunities.slice(0, 50);
        } catch (error) { await recordError("Search Console insights", error); }
      } catch (error) { await recordError("Search Console", error); }
    })(),
    (async () => {
      if (!propertyId) return;
      try {
        result.limitations!.push("GA4 includes only sessions in the Organic Search default channel group. Dates use the GA4 property's timezone, which may differ from Search Console; key events reflect property configuration and are not revenue.");
        const data = await fetchGoogleJson(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, { method: "POST", headers, body: JSON.stringify({ dateRanges: [{ startDate: result.startDate, endDate: result.endDate }], dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search", caseSensitive: true } } }, metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "screenPageViews" }, { name: "keyEvents" }] }) });
        if (!Array.isArray(data.rows) && data.rowCount !== 0 && !Array.isArray(data.metricHeaders)) throw new GoogleError("Google returned missing Analytics metrics.", 502);
        if (data.rows !== undefined && !Array.isArray(data.rows)) throw new GoogleError("Google returned invalid Analytics rows.", 502);
        const rows = list(data.rows);
        if (!rows.length) { if (typeof data.rowCount === "number" && data.rowCount > 0) throw new GoogleError("Google returned missing Analytics rows.", 502); result.ga4 = { users: 0, sessions: 0, pageViews: 0, keyEvents: 0, trafficScope: "organic-search" }; return; }
        const values = list(object(rows[0]).metricValues).map(value => numeric(object(value).value));
        if (values.length !== 4) throw new GoogleError("Google returned invalid Analytics metrics.", 502);
        result.ga4 = { users: values[0], sessions: values[1], pageViews: values[2], keyEvents: values[3], trafficScope: "organic-search" };
      } catch (error) { await recordError("Analytics", error); }
    })(),
  ]);
  if (errors.length) result.errors = errors;
  return result;
}

export function googleJson(data: unknown, status = 200): Response { return Response.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
export function googleErrorResponse(error: unknown): Response { return googleJson({ error: publicError(error), ...(error instanceof GoogleError ? { retryable: error.retryable, reconnectNeeded: error.reconnectNeeded } : {}) }, error instanceof GoogleError ? error.status : 500); }
