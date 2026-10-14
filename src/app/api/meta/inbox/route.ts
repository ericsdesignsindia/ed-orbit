import { assertMetaRequest, fetchMetaInbox, MetaError, metaJson, metaRequestOrigin, metaStatus, readMetaConfig, replyMetaInbox } from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    assertMetaRequest(request);
    const { config, missing } = readMetaConfig();
    if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
    if (metaRequestOrigin(request) !== config.baseUrl) throw new MetaError("Open Signal on its production address to view the Meta inbox.", 403);
    const url = new URL(request.url);
    const pageId = url.searchParams.get("pageId");
    const platform = url.searchParams.get("platform") ?? "messenger";
    const conversationId = url.searchParams.get("conversationId") ?? undefined;
    if (platform !== "messenger" && platform !== "instagram") throw new MetaError("Choose Facebook or Instagram Inbox.");
    const status = await metaStatus(config);
    if (!pageId) return metaJson({ pages: status.pages, connected: status.connected, conversations: [] });
    const inbox = await fetchMetaInbox(config, pageId, platform, conversationId);
    return metaJson({ pages: status.pages, connected: status.connected, ...inbox });
  } catch (error) {
    if (error instanceof MetaError) console.error("Meta Inbox request failed", { status: error.status, phase: error.phase, providerCode: error.providerCode, providerSubcode: error.providerSubcode, providerMessage: error.providerMessage });
    return metaJson({ error: error instanceof MetaError ? error.message : "Signal could not load the Meta inbox." }, error instanceof MetaError ? error.status : 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertMetaRequest(request, true);
    const { config, missing } = readMetaConfig();
    if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
    if (metaRequestOrigin(request) !== config.baseUrl) throw new MetaError("Open Signal on its production address to reply to Meta messages.", 403);
    if (Number(request.headers.get("content-length") ?? 0) > 10000) throw new MetaError("Message request is too large.", 413);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MetaError("Invalid message reply.");
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => !["pageId", "platform", "conversationId", "text"].includes(key)) || typeof input.pageId !== "string" || (input.platform !== "messenger" && input.platform !== "instagram") || typeof input.conversationId !== "string" || typeof input.text !== "string") throw new MetaError("Invalid message reply.");
    await replyMetaInbox(config, { pageId: input.pageId, platform: input.platform, conversationId: input.conversationId, text: input.text });
    return metaJson({ ok: true });
  } catch (error) {
    if (error instanceof MetaError) console.error("Meta Inbox reply failed", { status: error.status, phase: error.phase, providerCode: error.providerCode, providerSubcode: error.providerSubcode, providerMessage: error.providerMessage });
    return metaJson({ error: error instanceof MetaError ? error.message : "Signal could not send the Meta reply." }, error instanceof MetaError ? error.status : 500);
  }
}
