import { assertMetaRequest, MetaError, metaJson, publishMetaContent, readMetaConfig } from "@/lib/meta";
import { assertSocialRequest, readWorkspaceBody, WorkspaceError } from "@/lib/api-security";
import { getHostedSocialStore } from "@/lib/neon-social-store";
import { getSocialStore } from "@/lib/social-store";
import { currentTenantId } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function store() { return process.env.VERCEL === "1" ? await getHostedSocialStore(await currentTenantId()) : getSocialStore(); }
function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof WorkspaceError || error instanceof MetaError ? error.message : "Signal could not complete the publish request." }, {
    status: error instanceof WorkspaceError || error instanceof MetaError ? error.status : 500,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let workspace: Awaited<ReturnType<typeof store>> | undefined;
  let postId = "";
  try {
    assertSocialRequest(request, true);
    assertMetaRequest(request, true);
    const { config, missing } = readMetaConfig();
    if (!config) throw new MetaError(`Meta setup is missing or invalid: ${missing.join(", ")}.`, 503);
    const body = await readWorkspaceBody(request) as { postId?: unknown };
    if (!body || typeof body !== "object" || typeof body.postId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.postId)) throw new WorkspaceError("Choose a valid post to publish.");
    postId = body.postId;
    workspace = await store();
    const before = await workspace.getSnapshot();
    const post = before.posts.find(item => item.id === postId);
    if (!post || post.example) throw new WorkspaceError("This post is unavailable for publishing.", 404);
    if (post.status !== "Scheduled") throw new WorkspaceError("Only an approved post in the schedule can be published.", 409);
    if (post.platform !== "Facebook" && post.platform !== "Instagram") throw new WorkspaceError("Meta publishing supports Facebook and Instagram only.");

    // Persist a publishing lock before contacting Meta. This prevents a second
    // click from creating another public post while the first request runs.
    await workspace.dispatch({ action: "set-status", id: postId, status: "Publishing" });
    let receipt: Awaited<ReturnType<typeof publishMetaContent>>;
    try {
      receipt = await publishMetaContent(config, { platform: post.platform, caption: post.copy, assetUrl: post.assetUrl, type: post.type });
    } catch (error) {
      // Provider 5xx and timeout outcomes can be ambiguous; keep the lock so a
      // retry cannot create a duplicate. Known rejections are safe to retry.
      if (!(error instanceof MetaError) || error.status < 500) await workspace.dispatch({ action: "set-status", id: postId, status: "Scheduled" });
      throw error;
    }
    const snapshot = await workspace.dispatch({ action: "set-status", id: postId, status: "Published", publishedUrl: receipt.url });
    return metaJson({ snapshot, receipt: { url: receipt.url, postId: receipt.postId, destination: receipt.pageName } });
  } catch (error) { return errorResponse(error); }
}
