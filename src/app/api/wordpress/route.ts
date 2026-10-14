import { assertWorkspaceRequest, WorkspaceError } from "@/lib/api-security";
import { wordpressService, wordpressStatus } from "@/lib/wordpress";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: unknown) => json({ error: error instanceof WorkspaceError ? error.message : "WordPress operation failed." }, error instanceof WorkspaceError ? error.status : 500);
export async function GET(request: Request) {
  try {
    assertWorkspaceRequest(request);
    const status = wordpressStatus(); const site = new URL(request.url).searchParams.get("siteUrl");
    return json({ ...status, history: status.configured && site ? wordpressService().history(site) : [] });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    assertWorkspaceRequest(request, true);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new WorkspaceError("JSON is required.", 415);
    const reader = request.body?.getReader(); if (!reader) throw new WorkspaceError("A body is required.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 32 * 1024) { await reader.cancel(); throw new WorkspaceError("Body exceeds 32 KiB.", 413); } chunks.push(part.value); }
    let input: unknown; try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new WorkspaceError("Invalid JSON."); }
    return json({ change: await wordpressService().run(input) });
  } catch (error) { return failure(error); }
}
