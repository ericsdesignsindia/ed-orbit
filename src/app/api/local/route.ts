import { assertWorkspaceRequest, readWorkspaceBody, WorkspaceError } from "@/lib/api-security";
import { getLocalStore } from "@/lib/local-store";
import { currentTenantId } from "@/lib/tenant";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) { return Response.json({ error: error instanceof WorkspaceError ? error.message : "LocalPilot could not load or save. Check server storage and retry." }, { status: error instanceof WorkspaceError ? error.status : 500, headers }); }
export async function GET(request: Request) { try { assertWorkspaceRequest(request); return Response.json(await getLocalStore(await currentTenantId()).read(), { headers }); } catch (e) { return failure(e); } }
export async function POST(request: Request) { try { assertWorkspaceRequest(request, true); return Response.json(await getLocalStore(await currentTenantId()).dispatch(await readWorkspaceBody(request)), { headers }); } catch (e) { return failure(e); } }
