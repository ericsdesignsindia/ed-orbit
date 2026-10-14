import { assertMetaRequest, MetaError, metaErrorResponse, metaJson, metaRequestOrigin, readMetaConfig, startMetaOAuth } from "@/lib/meta";
import { currentTenantId } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    assertMetaRequest(request);
    const { config, missing } = readMetaConfig();
    if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
    if (metaRequestOrigin(request) !== config.baseUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${config.baseUrl}/api/social/session`,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    const destination = await startMetaOAuth(config, await currentTenantId());
    if (request.headers.get("accept")?.includes("application/json")) {
      return metaJson({ authorizationUrl: destination });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return metaErrorResponse(error);
  }
}
