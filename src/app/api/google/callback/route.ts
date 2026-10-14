import { assertLocalRequest, finishGoogleOAuth, googleErrorResponse, requireConfig } from "@/lib/google";
import { currentTenantId } from "@/lib/tenant";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { assertLocalRequest(request); } catch (error) { return googleErrorResponse(error); }
  let config;
  try { config = requireConfig(); } catch (error) { return googleErrorResponse(error); }
  let outcome = "error";
  try { await finishGoogleOAuth(request, config, await currentTenantId()); outcome = "connected"; } catch { /* Never expose OAuth code, state, or upstream error details. */ }
  return new Response(null, { status: 302, headers: { Location: `${config.baseUrl}/?google=${outcome}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
