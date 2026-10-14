import { neon } from "@neondatabase/serverless";
import { MetaError } from "./meta";
import { currentTenantId } from "./tenant";

const connection = () => {
  const value = process.env.DATABASE_URL;
  if (!value) throw new MetaError("Neon storage is not configured.", 503);
  return neon(value);
};
let setup: Promise<void> | undefined;
async function initialize(tenantId: string) {
  const sql = connection();
  setup ??= sql.query("CREATE TABLE IF NOT EXISTS signal_meta_tenant_vault (tenant_id text PRIMARY KEY, encrypted_tokens text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []).then(() => {}).catch(error => { setup = undefined; throw error; });
  await setup;
  const legacyOwner = process.env.CLERK_LEGACY_OWNER_ORG_ID;
  if (tenantId === "legacy" || (!!legacyOwner && tenantId === legacyOwner)) {
    await sql.query("CREATE TABLE IF NOT EXISTS signal_meta_vault (id integer PRIMARY KEY CHECK (id = 1), encrypted_tokens text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())", []);
    await sql.query("INSERT INTO signal_meta_tenant_vault (tenant_id, encrypted_tokens) SELECT $1, encrypted_tokens FROM signal_meta_vault WHERE id = 1 ON CONFLICT (tenant_id) DO NOTHING", [tenantId]);
  }
  return sql;
}
export async function readHostedMetaVault(): Promise<string | undefined> {
  const tenantId = await currentTenantId();
  const sql = await initialize(tenantId);
  const rows = await sql.query("SELECT encrypted_tokens FROM signal_meta_tenant_vault WHERE tenant_id = $1", [tenantId]) as Array<{ encrypted_tokens: string }>;
  return rows[0]?.encrypted_tokens;
}
export async function writeHostedMetaVault(encryptedTokens: string): Promise<void> {
  const tenantId = await currentTenantId();
  const sql = await initialize(tenantId);
  await sql.query("INSERT INTO signal_meta_tenant_vault (tenant_id, encrypted_tokens) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET encrypted_tokens = EXCLUDED.encrypted_tokens, updated_at = now()", [tenantId, encryptedTokens]);
}
export async function clearHostedMetaVault(): Promise<void> {
  const tenantId = await currentTenantId();
  const sql = await initialize(tenantId);
  await sql.query("DELETE FROM signal_meta_tenant_vault WHERE tenant_id = $1", [tenantId]);
}
