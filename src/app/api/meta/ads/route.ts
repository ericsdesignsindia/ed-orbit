import { assertMetaRequest, fetchMetaAdAccounts, fetchMetaAdCampaigns, manageMetaCampaign, MetaError, metaJson, metaRequestOrigin, readMetaConfig } from "@/lib/meta";
import { WorkspaceError } from "@/lib/api-security";
import { requireOrganizationAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    assertMetaRequest(request);
    const { config, missing } = readMetaConfig();
    if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
    if (metaRequestOrigin(request) !== config.baseUrl) throw new MetaError("Open Signal on its production address to view Meta Ads data.", 403);
    const url = new URL(request.url);
    const accounts = await fetchMetaAdAccounts(config);
    const accountId = url.searchParams.get("accountId");
    if (!accountId) return metaJson({ accounts, campaigns: null });
    const datePreset = url.searchParams.get("datePreset") ?? "last_30d";
    if (datePreset !== "last_7d" && datePreset !== "last_30d" && datePreset !== "last_90d") throw new MetaError("Choose a supported reporting period.");
    const account = accounts.find(item => item.id === accountId);
    if (!account) throw new MetaError("That ad account is not available to the connected Meta profile.", 403);
    const campaigns = await fetchMetaAdCampaigns(config, accountId, datePreset);
    return metaJson({ accounts, account, campaigns, datePreset });
  } catch (error) {
    if (error instanceof MetaError) console.error("Meta Ads request failed", { status: error.status, phase: error.phase, providerCode: error.providerCode, providerSubcode: error.providerSubcode, providerMessage: error.providerMessage });
    return metaJson({ error: error instanceof MetaError ? error.message : "Signal could not load Meta Ads data." }, error instanceof MetaError ? error.status : 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (process.env.CLERK_AUTH_ENABLED === "1" && process.env.CLERK_ORG_STORAGE_READY === "1") await requireOrganizationAdmin();
    assertMetaRequest(request, true);
    const { config, missing } = readMetaConfig();
    if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
    if (metaRequestOrigin(request) !== config.baseUrl) throw new MetaError("Open Signal on its production address to manage Meta campaigns.", 403);
    if (Number(request.headers.get("content-length") ?? 0) > 10000) throw new MetaError("Campaign request is too large.", 413);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MetaError("Invalid campaign request.");
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(key => !["accountId", "campaignId", "name", "objective", "status"].includes(key)) || typeof value.accountId !== "string" || typeof value.name !== "string") throw new MetaError("Invalid campaign details.");
    if (value.campaignId !== undefined && typeof value.campaignId !== "string") throw new MetaError("Invalid campaign reference.");
    if (value.objective !== undefined && typeof value.objective !== "string") throw new MetaError("Invalid campaign objective.");
    if (value.status !== undefined && value.status !== "ACTIVE" && value.status !== "PAUSED") throw new MetaError("Invalid campaign delivery status.");
    const result = await manageMetaCampaign(config, { accountId: value.accountId, ...(typeof value.campaignId === "string" ? { campaignId: value.campaignId } : {}), name: value.name, ...(typeof value.objective === "string" ? { objective: value.objective } : {}), ...(value.status === "ACTIVE" || value.status === "PAUSED" ? { status: value.status } : {}) });
    return metaJson({ ok: true, ...result }, value.campaignId ? 200 : 201);
  } catch (error) {
    if (error instanceof MetaError) console.error("Meta campaign change failed", { status: error.status, phase: error.phase, providerCode: error.providerCode, providerSubcode: error.providerSubcode, providerMessage: error.providerMessage });
    return metaJson({ error: error instanceof MetaError || error instanceof WorkspaceError ? error.message : "Signal could not update the Meta campaign." }, error instanceof MetaError || error instanceof WorkspaceError ? error.status : 500);
  }
}
