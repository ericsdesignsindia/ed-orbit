import { assertLocalRequest, googleStatus, googleErrorResponse, googleJson, readGoogleConfig } from "@/lib/google";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const { config, missing } = readGoogleConfig();
    return googleJson({ configured: !!config, missing, ...(config ? await googleStatus(config) : { connected: false, services: { gsc: false, ga4: false } }) });
  } catch (error) { return googleErrorResponse(error); }
}
