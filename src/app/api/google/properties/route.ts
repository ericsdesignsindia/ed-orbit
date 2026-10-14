import { assertLocalRequest, GoogleError, getGoogleSession, googleErrorResponse, googleJson, googleProperties, requireConfig, tokenServices } from "@/lib/google";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { assertLocalRequest(request); const session = await getGoogleSession(requireConfig()); if (!session) throw new GoogleError("Connect your Google account first.", 401, false, true); return googleJson(await googleProperties(session.accessToken, tokenServices(session))); }
  catch (error) { return googleErrorResponse(error); }
}
