import { assertLocalRequest, clearGoogleCookies, googleErrorResponse, googleJson } from "@/lib/google";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { assertLocalRequest(request, true); await clearGoogleCookies(); return googleJson({ connected: false }); }
  catch (error) { return googleErrorResponse(error); }
}
