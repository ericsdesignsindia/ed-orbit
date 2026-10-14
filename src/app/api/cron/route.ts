import { createRunner } from "@/lib/jobs";
import { getWorkspaceStore, listHostedTenantIds } from "@/lib/neon-store";
import { withTenantId } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function matchesSecret(supplied: string | null, secret: string): boolean {
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(supplied);
  const right = encoder.encode(`Bearer ${secret}`);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return mismatch === 0;
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Scheduled runner is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!matchesSecret(request.headers.get("authorization"), secret)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const orgMode = process.env.CLERK_AUTH_ENABLED === "1" && process.env.CLERK_ORG_STORAGE_READY === "1" && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
    const tenants = orgMode ? await listHostedTenantIds() : ["legacy"];
    let processed = 0;
    for (const tenantId of tenants) {
      await withTenantId(tenantId, async () => {
        const store = await getWorkspaceStore(tenantId);
        await createRunner(store).tick();
      });
      processed++;
    }
    return Response.json({ ok: true, processed: true, workspaces: processed }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Scheduled work could not run." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
