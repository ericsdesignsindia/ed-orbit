import { assertSocialRequest, readWorkspaceBody, WorkspaceError } from "@/lib/api-security";
import { getSocialStore } from "@/lib/social-store";
import { getHostedSocialStore } from "@/lib/neon-social-store";
import type { SocialRequest } from "@/lib/social-workspace";
import { currentTenantId } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Signal-Persistence": process.env.VERCEL === "1" ? "neon" : "sqlite" });
function failure(error: unknown): Response {
  return Response.json({ error: error instanceof WorkspaceError ? error.message : "Signal could not load or save your workspace. Check the local server and retry." }, { status: error instanceof WorkspaceError ? error.status : 500, headers: headers() });
}
async function store() { return process.env.VERCEL === "1" ? await getHostedSocialStore(await currentTenantId()) : getSocialStore(); }
export async function GET(request: Request): Promise<Response> {
  try { assertSocialRequest(request); return Response.json(await (await store()).getSnapshot(), { headers: headers() }); } catch (error) { return failure(error); }
}
export async function POST(request: Request): Promise<Response> {
  try {
    assertSocialRequest(request, true);
    const input = await readWorkspaceBody(request) as SocialRequest;
    if (process.env.VERCEL === "1" && input && typeof input === "object" && input.action === "hydrate-and-dispatch") {
      return Response.json(await (await getHostedSocialStore(await currentTenantId())).hydrateFromBrowser(input.base, input.next), { headers: headers() });
    }
    const workspace = await store();
    if (input && typeof input === "object" && input.action === "hydrate-and-dispatch") {
      await workspace.dispatch({ action: "restore", backup: input.base, confirmed: true });
      return Response.json(await workspace.dispatch(input.next), { headers: headers() });
    }
    return Response.json(await workspace.dispatch(input), { headers: headers() });
  } catch (error) { return failure(error); }
}
