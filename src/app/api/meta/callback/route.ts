import { assertMetaRequest, finishMetaOAuth, MetaError, metaErrorResponse, readMetaConfig } from "@/lib/meta";
import { currentTenantId } from "@/lib/tenant";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { assertMetaRequest(request); } catch (error) { return metaErrorResponse(error); }
  const { config } = readMetaConfig();
  const destination = config?.baseUrl ?? "https://seo-command-center-six.vercel.app";
  let outcome = "error";
  try { if (!config) throw new Error(); await finishMetaOAuth(request, config, await currentTenantId()); outcome = "connected"; } catch (error) {
    // Keep callback diagnostics useful without logging OAuth codes, tokens, raw provider responses, or secrets.
    console.error("Meta OAuth callback failed", error instanceof MetaError
      ? { type: "MetaError", status: error.status, reason: error.message, phase: error.phase, providerCode: error.providerCode, providerSubcode: error.providerSubcode, providerMessage: error.providerMessage }
      : { type: error instanceof Error ? error.name.slice(0, 80) : "UnknownError" });
  }
  return new Response(null, { status: 302, headers: { Location: `${destination}/?meta=${outcome}#settings`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
