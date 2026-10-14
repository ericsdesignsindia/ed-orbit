import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as https from "node:https";
import { isPublicIp, validateFetchUrl } from "./safe-fetch";
import { WorkspaceError } from "./api-security";

type Config = { siteUrl: string; username: string; password: string };
type Snapshot = { title: string; excerpt: string; modified: string; status: string; supportsExcerpt?: boolean };
export type WordPressReceipt = { id: string; siteUrl: string; postId: number; type: "posts" | "pages"; before: Snapshot; after: Pick<Snapshot, "title" | "excerpt">; applied?: Snapshot; state: "preview" | "applied" | "rolledback" | "failed" | "uncertain"; operation?: "apply" | "rollback"; created: string; message?: string };
type Transport = (config: Config, path: string, body?: { title: string; excerpt?: string }) => Promise<unknown>;
const names = ["WP_SITE_URL", "WP_USERNAME", "WP_APPLICATION_PASSWORD"] as const;
function origin(value: unknown): string {
  if (typeof value !== "string") throw new WorkspaceError("A website origin is required.");
  let url: URL;
  try { url = validateFetchUrl(value); } catch { throw new WorkspaceError("WordPress requires a public HTTPS origin."); }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || value.trim() !== value) throw new WorkspaceError("Use only the HTTPS website origin, without a path, query, or credentials.");
  return url.origin;
}
function snapshot(value: unknown): Snapshot {
  const v = value as { title?: { raw?: unknown }; excerpt?: { raw?: unknown }; modified_gmt?: unknown; status?: unknown };
  if (!v || typeof v.title?.raw !== "string" || (v.excerpt !== undefined && typeof v.excerpt.raw !== "string") || typeof v.modified_gmt !== "string" || !v.modified_gmt || typeof v.status !== "string" || !v.status) throw new WorkspaceError("WordPress did not return editable raw fields.", 502);
  const excerpt = typeof v.excerpt?.raw === "string" ? v.excerpt.raw : "";
  if (v.title.raw.length > 200 || excerpt.length > 5000) throw new WorkspaceError("Existing fields exceed the bounded editor limits.");
  return { title: v.title.raw, excerpt, modified: v.modified_gmt, status: v.status, supportsExcerpt: v.excerpt !== undefined };
}
const fieldsEqual = (a: Pick<Snapshot, "title" | "excerpt">, b: Pick<Snapshot, "title" | "excerpt">) => a.title === b.title && a.excerpt === b.excerpt;
const unchanged = (a: Snapshot, b: Snapshot) => fieldsEqual(a, b) && a.modified === b.modified && a.status === b.status;

/** Credentials are sent once, only to a validated and DNS-pinned configured origin. */
const nativeTransport: Transport = async (config, path, body) => {
  const base = origin(config.siteUrl);
  if (!/^\/wp-json\/wp\/v2\/(posts|pages)\/[1-9]\d*\?context=edit$/.test(path)) throw new WorkspaceError("Invalid WordPress endpoint.");
  const url = new URL(path, base);
  const payload = body ? JSON.stringify(body) : undefined;
  if (payload && Buffer.byteLength(payload) > 32 * 1024) throw new WorkspaceError("WordPress payload is too large.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new WorkspaceError("WordPress request timed out.", 504)); }, 15_000); });
  const work = async () => {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (controller.signal.aborted) throw new Error("Timed out");
    if (!addresses.length || addresses.some(a => !isPublicIp(a.address) || isIP(a.address) !== a.family)) throw new WorkspaceError("WordPress resolves to a restricted network.");
    const address = addresses[0];
    return new Promise<unknown>((resolve, reject) => {
      const req = https.request(url, { method: body ? "POST" : "GET", agent: false, signal: controller.signal, servername: url.hostname,
        lookup: (_host, options, callback) => { if (options.all) callback(null, [address]); else callback(null, address.address, address.family); },
        headers: { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`, Accept: "application/json", "Accept-Encoding": "identity", ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) },
      }, response => {
        if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300 || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") || Number(response.headers["content-length"]) > 1024 * 1024) {
          response.destroy(); reject(new WorkspaceError("WordPress rejected the request or returned an unsupported response. Redirects are not followed.", 502)); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) response.destroy(new Error("Response too large")); else chunks.push(chunk); });
        response.on("error", () => reject(new WorkspaceError("WordPress response was interrupted.", 502)));
        response.on("aborted", () => reject(new WorkspaceError("WordPress response was interrupted.", 502)));
        response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new WorkspaceError("WordPress returned invalid JSON.", 502)); } });
      });
      req.on("error", () => reject(new WorkspaceError("WordPress connection failed.", 502)));
      req.end(payload);
    });
  };
  try { return await Promise.race([work(), deadline]); } finally { clearTimeout(timer!); controller.abort(); }
};

/** Inject a :memory: database and transport for offline tests. No operations replay on startup. */
export function createWordPressService(db: DatabaseSync, config: Config, transport: Transport = nativeTransport) {
  const siteUrl = origin(config.siteUrl);
  if (!config.username || config.username.includes(":") || /[\r\n]/.test(config.username) || !config.password) throw new WorkspaceError("Invalid WordPress server credentials.");
  db.exec("CREATE TABLE IF NOT EXISTS wordpress_changes (id TEXT PRIMARY KEY, site TEXT NOT NULL, state TEXT NOT NULL, receipt TEXT NOT NULL)");
  let tail: Promise<unknown> = Promise.resolve();
  const save = (r: WordPressReceipt) => db.prepare("UPDATE wordpress_changes SET state=?, receipt=? WHERE id=?").run(r.state, JSON.stringify(r), r.id);
  const get = (id: string) => {
    const row = db.prepare("SELECT receipt FROM wordpress_changes WHERE id=? AND site=?").get(id, siteUrl) as { receipt: string } | undefined;
    if (!row) throw new WorkspaceError("Change not found for the configured website.", 404);
    return JSON.parse(row.receipt) as WordPressReceipt;
  };
  const checkSite = (input: unknown) => { if (origin(input) !== siteUrl) throw new WorkspaceError("Selected website does not match WP_SITE_URL.", 409); };
  const assertNoUncertain = (postId: number, type: string) => {
    const rows = db.prepare("SELECT receipt FROM wordpress_changes WHERE site=? AND state='uncertain'").all(siteUrl) as { receipt: string }[];
    if (rows.some(row => { const r = JSON.parse(row.receipt) as WordPressReceipt; return r.postId === postId && r.type === type; })) throw new WorkspaceError("This resource has an uncertain write. Reconcile its receipt before creating or applying another preview.", 409);
  };
  const read = async (r: WordPressReceipt) => snapshot(await transport(config, `/wp-json/wp/v2/${r.type}/${r.postId}?context=edit`));
  async function execute(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkspaceError("Invalid WordPress action.");
    const v = input as Record<string, unknown>;
    if (v.siteUrl !== undefined) checkSite(v.siteUrl);
    if (v.action === "preview") {
      checkSite(v.siteUrl);
      if (!Number.isSafeInteger(v.postId) || (v.postId as number) <= 0 || !["posts", "pages"].includes(v.type as string)) throw new WorkspaceError("Choose posts or pages and a positive integer ID.");
      if (typeof v.title !== "string" || v.title.length > 200 || typeof v.excerpt !== "string" || v.excerpt.length > 5000) throw new WorkspaceError("Title is limited to 200 characters and excerpt to 5000.");
      assertNoUncertain(v.postId as number, v.type as string);
      const r: WordPressReceipt = { id: randomUUID(), siteUrl, postId: v.postId as number, type: v.type as "posts" | "pages", before: {} as Snapshot, after: { title: v.title, excerpt: v.excerpt }, state: "preview", created: new Date().toISOString() };
      r.before = await read(r);
      if (r.before.supportsExcerpt === false && r.after.excerpt !== "") throw new WorkspaceError("This resource does not expose a native excerpt. Leave excerpt empty to update only its title.");
      db.prepare("INSERT INTO wordpress_changes (id,site,state,receipt) VALUES (?,?,?,?)").run(r.id, siteUrl, r.state, JSON.stringify(r));
      return r;
    }
    if (!["apply", "rollback", "reconcile"].includes(v.action as string) || typeof v.changeId !== "string" || v.changeId.length > 100) throw new WorkspaceError("Invalid action or change ID.");
    const r = get(v.changeId);
    if (v.action === "reconcile") {
      if (r.state !== "uncertain") return r;
      const current = await read(r);
      const target = r.operation === "rollback" ? r.before : r.after;
      if (fieldsEqual(current, target) && current.status === r.before.status) {
        r.state = r.operation === "rollback" ? "rolledback" : "applied";
        if (r.state === "applied") r.applied = current;
        r.message = "Reconciled by reading the exact current native fields and publication status.";
      } else { r.state = "failed"; r.message = "Current fields differ from the intended result. Create a new preview; this receipt cannot be retried."; }
      save(r); return r;
    }
    if (v.confirmed !== true) throw new WorkspaceError("Explicit approval is required.", 400);
    const rollback = v.action === "rollback";
    if ((!rollback && r.state !== "preview") || (rollback && (r.state !== "applied" || !r.applied))) throw new WorkspaceError("This change cannot be submitted again. Reconcile uncertain changes or create a new preview.", 409);
    assertNoUncertain(r.postId, r.type);
    const current = await read(r);
    if (!unchanged(current, rollback ? r.applied! : r.before)) throw new WorkspaceError("WordPress changed since the snapshot. Create a fresh preview; nothing was written.", 409);
    const expectedState = r.state;
    r.state = "uncertain"; r.operation = rollback ? "rollback" : "apply";
    r.message = "Write outcome not yet verified. Do not retry; reconcile by reading WordPress.";
    // Atomic pre-mark prevents another process or a restart from replaying this receipt.
    const claimed = db.prepare("UPDATE wordpress_changes SET state=?,receipt=? WHERE id=? AND state=?").run(r.state, JSON.stringify(r), r.id, expectedState);
    if (claimed.changes !== 1) throw new WorkspaceError("Change already claimed. Refresh its receipt.", 409);
    const target = rollback ? { title: r.before.title, excerpt: r.before.excerpt } : r.after;
    try {
      const body = r.before.supportsExcerpt === false ? { title: target.title } : target;
      const returned = snapshot(await transport(config, `/wp-json/wp/v2/${r.type}/${r.postId}?context=edit`, body));
      if (!fieldsEqual(returned, target) || returned.status !== r.before.status) throw new Error("Verification failed");
      const verified = await read(r);
      if (!fieldsEqual(verified, target) || verified.status !== r.before.status || verified.modified !== returned.modified) throw new Error("Verification failed");
      r.state = rollback ? "rolledback" : "applied";
      if (!rollback) r.applied = verified;
      r.message = "Write and follow-up read verified. Only native title and excerpt were requested.";
    } catch { r.message = "Write outcome is uncertain. No automatic retry will occur. Reconcile before making a new preview."; }
    save(r); return r;
  }
  return {
    run(input: unknown): Promise<WordPressReceipt> { const work = tail.then(() => execute(input)); tail = work.catch(() => undefined); return work; },
    history(selected: string) { checkSite(selected); return (db.prepare("SELECT receipt FROM wordpress_changes WHERE site=? ORDER BY rowid DESC LIMIT 100").all(siteUrl) as { receipt: string }[]).map(row => JSON.parse(row.receipt) as WordPressReceipt); },
  };
}

let singleton: ReturnType<typeof createWordPressService> | undefined;
export function wordpressStatus() {
  if (process.env.VERCEL === "1") return { configured: false, missing: [], siteUrl: null, error: "WordPress publishing is disabled on this deployment until its write receipts are stored durably." };
  const missing = names.filter(name => !process.env[name]?.trim());
  if (missing.length) return { configured: false, missing, siteUrl: null };
  try { return { configured: true, missing: [], siteUrl: origin(process.env.WP_SITE_URL) }; }
  catch { return { configured: false, missing: [], siteUrl: null, error: "WP_SITE_URL must be a public HTTPS origin without a path." }; }
}
export function wordpressService() {
  if (process.env.VERCEL === "1") throw new WorkspaceError("WordPress publishing is disabled on this deployment until its write receipts are stored durably.", 503);
  if (singleton) return singleton;
  if (!wordpressStatus().configured) throw new WorkspaceError("Configure WP_SITE_URL, WP_USERNAME, and WP_APPLICATION_PASSWORD on the server.", 503);
  const folder = process.env.ORBIT_DATA_DIR || join(process.cwd(), ".data"); mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, "wordpress.sqlite"); const db = new DatabaseSync(path); chmodSync(path, 0o600);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE;");
  singleton = createWordPressService(db, { siteUrl: process.env.WP_SITE_URL!, username: process.env.WP_USERNAME!, password: process.env.WP_APPLICATION_PASSWORD! });
  return singleton;
}
