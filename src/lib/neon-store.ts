import { neon } from "@neondatabase/serverless";
import type { AppSnapshot, JobRecord } from "./contracts";
import { createStore, validateSnapshot, type JobInput } from "./store";
import { WorkspaceError } from "./api-security";

type LocalStore = ReturnType<typeof createStore>;
type AsyncStore = {
  getSnapshot: () => Promise<AppSnapshot>;
  dispatch: (input: unknown) => Promise<AppSnapshot>;
  enqueueJob: (input: JobInput) => Promise<JobRecord>;
  mutate: <T>(fn: (snapshot: AppSnapshot) => T, backup?: boolean) => Promise<T>;
  close: () => void;
  recoveryCount: () => Promise<number>;
};

const emptySnapshot = (): AppSnapshot => ({ version: 2, revision: 0, sites: [], crawls: [], reports: [], jobs: [], schedules: [], notifications: [], runner: { active: false, localOnly: true }, migrationComplete: false });

/**
 * Hosted persistence for the single SEO workspace. Mutations use revision-based
 * compare-and-swap so concurrent Vercel function instances cannot overwrite a
 * newer snapshot. A private in-memory SQLite store continues to own validation
 * and the existing action rules; only the durable snapshot lives in Neon.
 */
export function createNeonStore(connectionString: string, tenantId = "legacy"): AsyncStore {
  if (!connectionString) throw new WorkspaceError("Neon storage is not configured.", 503);
  const sql = neon(connectionString);
  const engine: LocalStore = createStore(":memory:");
  let initialized: Promise<void> | undefined;

  async function initialize(): Promise<void> {
    initialized ??= (async () => {
      await sql.query("CREATE TABLE IF NOT EXISTS seo_tenant_workspaces (tenant_id text PRIMARY KEY, revision bigint NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []);
      await sql.query("CREATE TABLE IF NOT EXISTS seo_tenant_recovery_snapshots (tenant_id text NOT NULL, revision bigint NOT NULL, created_at timestamptz NOT NULL, body jsonb NOT NULL, PRIMARY KEY (tenant_id, revision))", []);
      const legacyOwner = process.env.CLERK_LEGACY_OWNER_ORG_ID;
      const canAdoptLegacy = tenantId === "legacy" || (!!legacyOwner && tenantId === legacyOwner);
      if (canAdoptLegacy) {
        await sql.query("CREATE TABLE IF NOT EXISTS seo_workspace (id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []);
        await sql.query("INSERT INTO seo_tenant_workspaces (tenant_id, revision, body) SELECT $1, revision, body FROM seo_workspace WHERE id = 1 ON CONFLICT (tenant_id) DO NOTHING", [tenantId]);
      }
      await sql.query("INSERT INTO seo_tenant_workspaces (tenant_id, revision, body) VALUES ($1, 0, $2::jsonb) ON CONFLICT (tenant_id) DO NOTHING", [tenantId, JSON.stringify(emptySnapshot())]);
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }

  async function read(): Promise<AppSnapshot> {
    await initialize();
    const rows = await sql.query("SELECT revision, body FROM seo_tenant_workspaces WHERE tenant_id = $1", [tenantId]) as Array<{ revision: string | number; body: unknown }>;
    if (!rows.length) throw new WorkspaceError("Neon workspace storage is unavailable.", 503);
    const body = typeof rows[0].body === "string" ? JSON.parse(rows[0].body) : rows[0].body;
    const snapshot = body as AppSnapshot;
    snapshot.revision = Number(rows[0].revision);
    validateSnapshot(snapshot);
    return snapshot;
  }

  async function commit(before: AppSnapshot, after: AppSnapshot, backup: boolean): Promise<boolean> {
    const common = `WITH previous AS MATERIALIZED (
      SELECT body, revision FROM seo_tenant_workspaces WHERE tenant_id = $1 AND revision = $2 FOR UPDATE
    )`;
    const backupCte = backup ? `, saved AS (
      INSERT INTO seo_tenant_recovery_snapshots (tenant_id, revision, created_at, body)
      SELECT $1, revision, $4::timestamptz, body FROM previous
      ON CONFLICT (tenant_id, revision) DO NOTHING
    )` : "";
    const query = `${common}${backupCte}, updated AS (
      UPDATE seo_tenant_workspaces AS current
      SET body = $3::jsonb, revision = current.revision + 1, updated_at = $4::timestamptz
      FROM previous
      WHERE current.tenant_id = $1 AND current.revision = previous.revision
      RETURNING current.revision
    ) SELECT revision FROM updated`;
    const rows = await sql.query(query, [tenantId, before.revision, JSON.stringify(after), new Date().toISOString()]) as Array<{ revision: string | number }>;
    return rows.length === 1;
  }

  async function mutate<T>(fn: (snapshot: AppSnapshot) => T, backup = false): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await read();
      engine.replaceSnapshot(before);
      const result = engine.mutate(fn);
      const after = engine.getSnapshot();
      if (await commit(before, after, backup)) return result;
    }
    throw new WorkspaceError("The workspace changed while saving. Retry the action.", 409);
  }

  async function dispatch(input: unknown): Promise<AppSnapshot> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await read();
      engine.replaceSnapshot(before);
      const after = engine.dispatch(input);
      if (await commit(before, after, !!(input && typeof input === "object" && (input as { action?: unknown }).action === "restore"))) return await read();
    }
    throw new WorkspaceError("The workspace changed while saving. Retry the action.", 409);
  }

  async function enqueueJob(input: JobInput): Promise<JobRecord> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await read();
      engine.replaceSnapshot(before);
      const record = engine.enqueueJob(input);
      if (await commit(before, engine.getSnapshot(), false)) return record;
    }
    throw new WorkspaceError("The workspace changed while saving. Retry the action.", 409);
  }

  return {
    getSnapshot: read,
    dispatch,
    enqueueJob,
    mutate,
    close: () => engine.close(),
    async recoveryCount() {
      await initialize();
      const rows = await sql.query("SELECT count(*)::integer AS count FROM seo_tenant_recovery_snapshots WHERE tenant_id = $1", [tenantId]) as Array<{ count: number }>;
      return Number(rows[0]?.count ?? 0);
    },
  };
}

const remoteStores = new Map<string, AsyncStore>();
export async function listHostedTenantIds(): Promise<string[]> {
  if (!process.env.DATABASE_URL) throw new WorkspaceError("Neon storage is not configured.", 503);
  const sql = neon(process.env.DATABASE_URL);
  await sql.query("CREATE TABLE IF NOT EXISTS seo_tenant_workspaces (tenant_id text PRIMARY KEY, revision bigint NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []);
  const rows = await sql.query("SELECT tenant_id FROM seo_tenant_workspaces ORDER BY tenant_id", []) as Array<{ tenant_id: string }>;
  return rows.map(row => row.tenant_id).filter(value => typeof value === "string" && value.length > 0);
}
export async function getWorkspaceStore(tenantId = "legacy"): Promise<LocalStore | AsyncStore> {
  if (process.env.VERCEL === "1") {
    if (!remoteStores.has(tenantId)) remoteStores.set(tenantId, createNeonStore(process.env.DATABASE_URL ?? "", tenantId));
    return remoteStores.get(tenantId)!;
  }
  return (await import("./store")).getStore();
}
