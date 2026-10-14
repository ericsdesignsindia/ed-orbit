import { assertLocalRequest, GoogleError, googleErrorResponse, googleJson, googleReport, requireAccessToken } from "@/lib/google";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const token = await requireAccessToken();
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new GoogleError("A JSON request body is required.", 415);
    if (Number(request.headers.get("content-length")) > 8192) throw new GoogleError("Request body is too large.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new GoogleError("A JSON request body is required.");
    const chunks: Uint8Array[] = []; let size = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new GoogleError("Request body timed out.", 408, true)); }, 10_000); });
    try { while (true) { const { done, value } = await Promise.race([reader.read(), deadline]); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); throw new GoogleError("Request body is too large.", 413); } chunks.push(value); } } finally { clearTimeout(timeout); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new GoogleError("A valid JSON request body is required."); }
    return googleJson(await googleReport(token, body));
  } catch (error) { return googleErrorResponse(error); }
}
