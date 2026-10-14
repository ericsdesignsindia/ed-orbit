import { addDays, todayInZone, type ClientInput, type SocialSnapshot } from "@/lib/social-workspace";
import { assertMetaRequest, fetchMetaInsights, MetaError, metaJson, readMetaConfig } from "@/lib/meta";
import { assertSocialRequest, readWorkspaceBody, WorkspaceError } from "@/lib/api-security";
import { getHostedSocialStore } from "@/lib/neon-social-store";
import { getSocialStore } from "@/lib/social-store";
import { currentTenantId } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function store() { return process.env.VERCEL === "1" ? await getHostedSocialStore(await currentTenantId()) : getSocialStore(); }
function errorResponse(error: unknown) {
  if (error instanceof MetaError) console.error("Meta insights sync failed", { status: error.status, phase: error.phase, providerCode: error.providerCode, providerSubcode: error.providerSubcode, providerMessage: error.providerMessage });
  return Response.json({ error: error instanceof WorkspaceError || error instanceof MetaError ? error.message : "Signal could not sync Meta insights." }, {
    status: error instanceof WorkspaceError || error instanceof MetaError ? error.status : 500,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
function normalizedName(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

export async function POST(request: Request): Promise<Response> {
  try {
    assertSocialRequest(request, true);
    assertMetaRequest(request, true);
    const { config, missing } = readMetaConfig();
    if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
    const input = await readWorkspaceBody(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkspaceError("Invalid insights request.");
    const today = todayInZone(), from = addDays(today, -29);
    const report = await fetchMetaInsights(config, from, today);
    if (normalizedName(report.page.name) !== "ericsdesigns" || report.page.instagramUsername?.toLowerCase() !== "eric_sdesigns") throw new MetaError("Meta returned a different Page or Instagram profile than the Eric's Designs account selected for Signal.", 403);

    const workspace = await store();
    let snapshot: SocialSnapshot = await workspace.getSnapshot();
    let client = snapshot.clients.find(value => normalizedName(value.name) === "ericsdesigns");
    const facebook = { platform: "Facebook" as const, handle: report.page.name, url: report.page.link };
    const instagram = { platform: "Instagram" as const, handle: `@${report.page.instagramUsername}`, url: `https://www.instagram.com/${report.page.instagramUsername}/` };
    if (client?.archived) snapshot = await workspace.dispatch({ action: "archive-client", id: client.id, archived: false });
    client = snapshot.clients.find(value => normalizedName(value.name) === "ericsdesigns");
    if (client) {
      const existingFacebook = client.channels.find(channel => channel.platform === "Facebook");
      const existingInstagram = client.channels.find(channel => channel.platform === "Instagram");
      if (existingInstagram && existingInstagram.handle.replace(/^@/, "").toLowerCase() !== "eric_sdesigns") throw new WorkspaceError("The Eric's Designs client already has a different Instagram profile. Update that profile before syncing Meta.", 409);
      const channels = [...client.channels.filter(channel => channel.platform !== "Facebook" && channel.platform !== "Instagram"), existingFacebook ?? facebook, existingInstagram ?? instagram];
      snapshot = await workspace.dispatch({ action: "save-client", client: { id: client.id, name: client.name, handle: client.handle || "@eric_sdesigns", email: client.email, channels } satisfies ClientInput });
      client = snapshot.clients.find(value => value.id === client!.id)!;
    } else {
      snapshot = await workspace.dispatch({ action: "save-client", client: { name: report.page.name, handle: "@eric_sdesigns", email: "", channels: [facebook, instagram] } satisfies ClientInput });
      client = snapshot.clients.find(value => normalizedName(value.name) === "ericsdesigns")!;
    }
    if (report.metrics.length) {
      snapshot = await workspace.dispatch({ action: "save-metrics", metrics: report.metrics.map(metric => ({ ...metric, clientId: client!.id })) });
    }
    return metaJson({ snapshot, clientId: client.id, count: report.metrics.length, from, to: today, destination: `${report.page.name} · @${report.page.instagramUsername}` });
  } catch (error) { return errorResponse(error); }
}
