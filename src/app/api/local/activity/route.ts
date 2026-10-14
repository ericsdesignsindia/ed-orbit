import { assertWorkspaceRequest, readWorkspaceBody, WorkspaceError } from "@/lib/api-security";
import { getLocalStore } from "@/lib/local-store";
import { currentTenantId } from "@/lib/tenant";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// This endpoint accepts only activity and enquiries for a published page, never admin mutations.
const windows = new Map<string, { count: number; expires: number }>();
export async function POST(request: Request) {
  try {
    assertWorkspaceRequest(request, true);
    const key = request.headers.get("x-forwarded-for")?.slice(0, 100) || "local", now = Date.now();
    for (const [id, entry] of windows) if (entry.expires < now) windows.delete(id);
    const entry = windows.get(key) ?? { count: 0, expires: now + 60_000 };
    if (++entry.count > 60) throw new WorkspaceError("Too many requests. Please try again in a minute.", 429);
    if (windows.size < 5000 || windows.has(key)) windows.set(key, entry);
    await getLocalStore(await currentTenantId()).activity(await readWorkspaceBody(request));
    return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: e instanceof WorkspaceError ? e.message : "The enquiry could not be saved. Please retry or contact the business directly." }, { status: e instanceof WorkspaceError ? e.status : 500 }); }
}
