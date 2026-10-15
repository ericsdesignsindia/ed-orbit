import { neon } from "@neondatabase/serverless";
import type { SocialSnapshot } from "./social-workspace";
import { createEmptyWorkspace } from "./social-workspace";
import { createSocialStore, validateSocialSnapshot } from "./social-store";
import { WorkspaceError } from "./api-security";

type Engine = ReturnType<typeof createSocialStore>;
type HostedStore = {
  getSnapshot: () => Promise<SocialSnapshot>;
  dispatch: (input: unknown) => Promise<SocialSnapshot>;
  hydrateFromBrowser: (base: SocialSnapshot, next: unknown) => Promise<SocialSnapshot>;
};

export function createNeonSocialStore(connectionString: string, tenantId = "legacy"): HostedStore {
  if (!connectionString) throw new WorkspaceError("Neon storage is not configured.", 503);
  const sql = neon(connectionString);
  const engine: Engine = createSocialStore(":memory:");
  let initialized: Promise<void> | undefined;

  async function initialize(): Promise<void> {
    initialized ??= (async () => {
      await sql.query("CREATE TABLE IF NOT EXISTS signal_tenant_workspaces (tenant_id text PRIMARY KEY, revision bigint NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []);
      await sql.query("CREATE TABLE IF NOT EXISTS signal_tenant_recovery_snapshots (tenant_id text NOT NULL, revision bigint NOT NULL, created_at timestamptz NOT NULL, body jsonb NOT NULL, PRIMARY KEY (tenant_id, revision))", []);
      const legacyOwner = process.env.CLERK_LEGACY_OWNER_ORG_ID;
      const canAdoptLegacy = tenantId === "legacy" || (!!legacyOwner && tenantId === legacyOwner);
      if (canAdoptLegacy) {
        await sql.query("CREATE TABLE IF NOT EXISTS signal_workspace (id integer PRIMARY KEY CHECK (id = 1), revision bigint NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []);
        await sql.query("INSERT INTO signal_tenant_workspaces (tenant_id, revision, body) SELECT $1, revision, body FROM signal_workspace WHERE id = 1 ON CONFLICT (tenant_id) DO NOTHING", [tenantId]);
      }
      await sql.query("INSERT INTO signal_tenant_workspaces (tenant_id, revision, body) VALUES ($1, 0, $2::jsonb) ON CONFLICT (tenant_id) DO NOTHING", [tenantId, JSON.stringify(createEmptyWorkspace())]);
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }

  async function read(): Promise<SocialSnapshot> {
    await initialize();
    const rows = await sql.query("SELECT revision, body FROM signal_tenant_workspaces WHERE tenant_id = $1", [tenantId]) as Array<{ revision: string | number; body: unknown }>;
    if (!rows.length) throw new WorkspaceError("Signal storage is unavailable.", 503);
    const body = typeof rows[0].body === "string" ? JSON.parse(rows[0].body) : rows[0].body;
    const snapshot = body as SocialSnapshot;
    snapshot.revision = Number(rows[0].revision);
    return validateSocialSnapshot(snapshot);
  }

  async function commit(before: SocialSnapshot, after: SocialSnapshot, backup: boolean): Promise<boolean> {
    const common = `WITH previous AS MATERIALIZED (
      SELECT body, revision FROM signal_tenant_workspaces WHERE tenant_id = $1 AND revision = $2 FOR UPDATE
    )`;
    const backupCte = backup ? `, saved AS (
      INSERT INTO signal_tenant_recovery_snapshots (tenant_id, revision, created_at, body)
      SELECT $1, revision, $4::timestamptz, body FROM previous
      ON CONFLICT (tenant_id, revision) DO NOTHING
    )` : "";
    const query = `${common}${backupCte}, updated AS (
      UPDATE signal_tenant_workspaces AS current
      SET body = $3::jsonb, revision = current.revision + 1, updated_at = $4::timestamptz
      FROM previous
      WHERE current.tenant_id = $1 AND current.revision = previous.revision
      RETURNING current.revision
    ) SELECT revision FROM updated`;
    const rows = await sql.query(query, [tenantId, before.revision, JSON.stringify(after), new Date().toISOString()]) as Array<{ revision: string | number }>;
    return rows.length === 1;
  }

  async function dispatch(input: unknown): Promise<SocialSnapshot> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await read();
      engine.replaceSnapshot(before);
      const after = engine.dispatch(input);
      const backup = !!(input && typeof input === "object" && (input as { action?: unknown }).action === "restore");
      if (await commit(before, after, backup)) return await read();
    }
    throw new WorkspaceError("Signal changed while saving. Retry the action.", 409);
  }

  async function hydrateFromBrowser(base: SocialSnapshot, next: unknown): Promise<SocialSnapshot> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await read();
      if (before.revision !== 0 || before.clients.length || before.posts.length || before.notes.length || before.metrics.length) return before;
      engine.replaceSnapshot(before);
      engine.dispatch({ action: "restore", backup: base, confirmed: true });
      const after = engine.dispatch(next);
      if (await commit(before, after, true)) return await read();
    }
    throw new WorkspaceError("Signal changed while importing the browser workspace. Refresh and retry.", 409);
  }

  return { getSnapshot: read, dispatch, hydrateFromBrowser };
}

const hostedStores = new Map<string, HostedStore>();
export async function getHostedSocialStore(tenantId = "legacy"): Promise<HostedStore> {
  if (!hostedStores.has(tenantId)) hostedStores.set(tenantId, createNeonSocialStore(process.env.DATABASE_URL ?? "", tenantId));
  return hostedStores.get(tenantId)!;
}
