import { assertLocalRequest, GoogleError, googleErrorResponse, localRequestOrigin, requireConfig, startGoogleOAuth } from "@/lib/google";
import { currentTenantId } from "@/lib/tenant";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const config = requireConfig();
    const service = new URL(request.url).searchParams.get("service") ?? "both";
    if (!["gsc", "ga4", "both"].includes(service)) throw new GoogleError("Choose gsc, ga4, or both.");
    // State and token cookies must belong to the registered callback host.
    const destination = localRequestOrigin(request) === config.baseUrl ? await startGoogleOAuth(config, service, await currentTenantId()) : `${config.baseUrl}/api/google/connect?service=${service}`;
    return new Response(null, { status: 302, headers: { Location: destination, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return googleErrorResponse(error); }
}
