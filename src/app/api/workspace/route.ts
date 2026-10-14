import { assertWorkspaceRequest, readWorkspaceBody, WorkspaceError } from "@/lib/api-security";
import { getWorkspaceStore } from "@/lib/neon-store";
import { createRunner, ensureRunner } from "@/lib/jobs";
import { currentTenantId } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
function failure(error: unknown): Response { return Response.json({ error: error instanceof WorkspaceError ? error.message : "Workspace could not be loaded or saved. Existing data has been preserved; check the local server." }, { status: error instanceof WorkspaceError ? error.status : 500, headers }); }
export async function GET(request: Request): Promise<Response> {
  try {
    assertWorkspaceRequest(request);
    if (process.env.VERCEL !== "1") ensureRunner();
    const snapshot = await (await getWorkspaceStore(await currentTenantId())).getSnapshot();
    return Response.json(snapshot, { headers: { ...headers, ...(new URL(request.url).searchParams.get("export") === "1" ? { "Content-Disposition": `attachment; filename="seo-command-center-${new Date().toISOString().slice(0, 10)}.json"` } : {}) } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request): Promise<Response> {
  try {
    assertWorkspaceRequest(request, true);
    const input = await readWorkspaceBody(request);
    const store = await getWorkspaceStore(await currentTenantId());
    const snapshot = await store.dispatch(input);
    if (process.env.VERCEL !== "1") ensureRunner();
    else if (input && typeof input === "object" && (input as { action?: unknown }).action === "enqueue") await createRunner(store).tick();
    return Response.json(process.env.VERCEL === "1" && input && typeof input === "object" && (input as { action?: unknown }).action === "enqueue" ? await store.getSnapshot() : snapshot, { headers });
  } catch (error) { return failure(error); }
}
