import { assertMetaRequest, MetaError, metaErrorResponse, metaJson, metaRequestOrigin, metaStatus, readMetaConfig } from "@/lib/meta";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertMetaRequest(request);
    const { config, missing } = readMetaConfig();
    if (config && metaRequestOrigin(request) !== config.baseUrl) throw new MetaError("Open Signal on its production address to manage the shared Meta connection.", 403);
    return metaJson({ configured: !!config, missing, ...(config ? await metaStatus(config) : { connected: false, pages: [] }) });
  } catch (error) { return metaErrorResponse(error); }
}
