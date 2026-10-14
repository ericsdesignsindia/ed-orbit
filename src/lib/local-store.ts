import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { WorkspaceError } from "./api-security";
import { emptyLocalWorkspace, validateLocalWorkspace, changeLocalWorkspace, recordPublicActivity, type LocalWorkspace } from "./local-workspace";

type Update = (snapshot: LocalWorkspace) => LocalWorkspace;
export type LocalStore = { read: () => Promise<LocalWorkspace>; update: (fn: Update) => Promise<LocalWorkspace>; dispatch: (input: unknown) => Promise<LocalWorkspace>; activity: (input: unknown) => Promise<void>; close: () => void };
export function createLocalStore(path = ":memory:"): LocalStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    if (Object.values(db.prepare("PRAGMA quick_check").get() ?? {})[0] !== "ok") throw new WorkspaceError("LocalPilot database needs recovery. The file has been preserved.", 500);
    db.exec("CREATE TABLE IF NOT EXISTS localpilot (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS localpilot_secrets (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)");
    db.prepare("INSERT OR IGNORE INTO localpilot VALUES (1, ?)").run(JSON.stringify(emptyLocalWorkspace()));
  } catch (error) { db.close(); throw error; }
  const read = () => validateLocalWorkspace(JSON.parse(String(db.prepare("SELECT body FROM localpilot WHERE id=1").get()!.body)));
  try { read(); } catch (error) { db.close(); throw error; }
  const update = async (fn: Update) => {
    db.exec("BEGIN IMMEDIATE");
    try { const next = validateLocalWorkspace(fn(read())); db.prepare("UPDATE localpilot SET body=? WHERE id=1").run(JSON.stringify(next)); db.exec("COMMIT"); return next; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  return { read: async () => read(), update, dispatch: input => update(s => changeLocalWorkspace(s, input)), activity: async input => { await update(s => recordPublicActivity(s, input)); }, close: () => db.close() };
}
function createHostedStore(tenantId: string): LocalStore {
  if (!process.env.DATABASE_URL) throw new WorkspaceError("Configure DATABASE_URL for persistent LocalPilot storage.", 503);
  const sql = neon(process.env.DATABASE_URL); let initialized: Promise<void> | undefined;
  const init = () => initialized ??= (async () => {
    await sql.query("CREATE TABLE IF NOT EXISTS localpilot_tenant_workspace (tenant_id text PRIMARY KEY, revision bigint NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []);
    const legacyOwner = process.env.CLERK_LEGACY_OWNER_ORG_ID;
    if (tenantId === "legacy" || (!!legacyOwner && tenantId === legacyOwner)) {
      await sql.query("CREATE TABLE IF NOT EXISTS localpilot_workspace (id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL, body jsonb NOT NULL)", []);
      await sql.query("INSERT INTO localpilot_tenant_workspace (tenant_id, revision, body) SELECT $1, revision, body FROM localpilot_workspace WHERE id = 1 ON CONFLICT (tenant_id) DO NOTHING", [tenantId]);
    }
    await sql.query("INSERT INTO localpilot_tenant_workspace (tenant_id, revision, body) VALUES ($1,0,$2::jsonb) ON CONFLICT(tenant_id) DO NOTHING", [tenantId, JSON.stringify(emptyLocalWorkspace())]);
  })().catch(error => { initialized = undefined; throw error; });
  const read = async () => { await init(); const rows = await sql.query("SELECT body FROM localpilot_tenant_workspace WHERE tenant_id=$1", [tenantId]) as { body: unknown }[]; if (!rows.length) throw new WorkspaceError("LocalPilot storage is unavailable.", 503); return validateLocalWorkspace(typeof rows[0].body === "string" ? JSON.parse(rows[0].body) : rows[0].body); };
  const update = async (fn: Update) => {
    for (let i = 0; i < 5; i++) { const before = await read(), next = validateLocalWorkspace(fn(before)); const rows = await sql.query("UPDATE localpilot_tenant_workspace SET revision=$1,body=$2::jsonb,updated_at=now() WHERE tenant_id=$3 AND revision=$4 RETURNING tenant_id", [next.revision, JSON.stringify(next), tenantId, before.revision]) as unknown[]; if (rows.length) return next; }
    throw new WorkspaceError("The workspace changed while saving. Refresh and retry.", 409);
  };
  return { read, update, dispatch: input => update(s => changeLocalWorkspace(s, input)), activity: async input => { await update(s => recordPublicActivity(s, input)); }, close: () => {} };
}
const state = globalThis as typeof globalThis & { localpilotStore?: LocalStore; localpilotTenantStores?: Map<string, LocalStore> };
export const localDataPath = () => join(process.env.LOCALPILOT_DATA_DIR || process.env.ORBIT_DATA_DIR || join(process.cwd(), ".data"), "localpilot.sqlite");
export function getLocalStore(tenantId = "legacy"): LocalStore {
  if (process.env.VERCEL !== "1") return state.localpilotStore ??= createLocalStore(localDataPath());
  const stores = state.localpilotTenantStores ??= new Map();
  if (!stores.has(tenantId)) stores.set(tenantId, createHostedStore(tenantId));
  return stores.get(tenantId)!;
}
