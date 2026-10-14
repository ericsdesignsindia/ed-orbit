import { assertMetaRequest, disconnectMeta, metaErrorResponse, metaJson, metaRequestOrigin, MetaError, readMetaConfig } from "@/lib/meta";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertMetaRequest(request, true);
    const { config } = readMetaConfig();
    if (!config) return metaJson({ disconnected: false, error: "Meta setup is not configured." }, 503);
    if (metaRequestOrigin(request) !== config.baseUrl) throw new MetaError("Open Signal on its production address to manage the shared Meta connection.", 403);
    await disconnectMeta(config);
    return metaJson({ disconnected: true });
  } catch (error) { return metaErrorResponse(error); }
}
