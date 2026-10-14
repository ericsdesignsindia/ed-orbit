import { lookup } from "node:dns/promises";
import { isPublicIp, validateFetchUrl } from "../../../lib/safe-fetch";
import { normalizeWebsiteUrl } from "../../../lib/site-url";
import { assertWorkspaceRequest } from "../../../lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
let active = 0; const recent: number[] = [];
function trusted(request: Request): boolean {
  try {
    assertWorkspaceRequest(request, true);
    return true;
  } catch { return false; }
}
async function boundedBody(stream: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal): Promise<string> {
  if (!stream) throw new Error("Empty response"); const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) throw new Error("Response too large"); chunks.push(value); } return Buffer.concat(chunks).toString("utf8"); }
  finally { signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); }
}
export async function POST(request: Request): Promise<Response> {
  if (!trusted(request)) return json({ error: "Only same-origin requests from the configured local app are allowed." }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return json({ error: "Use application/json." }, 415);
  const now = Date.now(); while (recent.length && recent[0] < now - 60000) recent.shift();
  if (active >= 2 || recent.length >= 6) return json({ error: "PageSpeed request limit reached. Try again in a minute." }, 429);
  active++; recent.push(now); const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); void request.body?.cancel().catch(() => {}); reject(new Error("PageSpeed timed out")); }, 30000); });
  const work = async (): Promise<Response> => {
    let url: URL; let strategy: "mobile" | "desktop";
    try {
      if (Number(request.headers.get("content-length")) > 4096) throw new Error("Body too large");
      const body = JSON.parse(await boundedBody(request.body, 4096, controller.signal)) as { url?: unknown; strategy?: unknown };
      if (typeof body.url !== "string" || !["mobile", "desktop"].includes(String(body.strategy))) throw new Error("Invalid request");
      url = validateFetchUrl(normalizeWebsiteUrl(body.url)); strategy = body.strategy as typeof strategy;
      const addresses = await lookup(url.hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(a => !isPublicIp(a.address))) throw new Error("Restricted target");
      if (controller.signal.aborted) throw new Error("Timed out");
    } catch { return json({ error: "Provide a public website URL and strategy mobile or desktop." }, 400); }
    const upstream = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    upstream.searchParams.set("url", url.href); upstream.searchParams.set("strategy", strategy); upstream.searchParams.set("category", "performance");
    if (process.env.PAGESPEED_API_KEY) upstream.searchParams.set("key", process.env.PAGESPEED_API_KEY);
    const response = await fetch(upstream, { signal: controller.signal, redirect: "error", cache: "no-store" });
    if (!response.ok) { await response.body?.cancel(); return json({ error: response.status === 429 ? "Google PageSpeed quota exceeded. Try again later." : `Google PageSpeed returned HTTP ${response.status}. No performance score was recorded.` }, response.status === 429 ? 429 : 502); }
    if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024) { await response.body?.cancel(); throw new Error("Response too large"); }
    const data = JSON.parse(await boundedBody(response.body, 4 * 1024 * 1024, controller.signal));
    const score = data.lighthouseResult?.categories?.performance?.score;
    const performanceScore = typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1 ? Math.round(score * 100) : null;
    const metrics: { name: string; value: string }[] = [];
    for (const [id, name] of [["first-contentful-paint", "Lab First Contentful Paint"], ["largest-contentful-paint", "Lab Largest Contentful Paint"], ["total-blocking-time", "Lab Total Blocking Time"], ["cumulative-layout-shift", "Lab Cumulative Layout Shift"], ["speed-index", "Lab Speed Index"]]) {
      const value = data.lighthouseResult?.audits?.[id]?.displayValue; if (typeof value === "string") metrics.push({ name, value: value.slice(0, 200) });
    }
    const fieldDataAvailable = Object.keys(data.loadingExperience?.metrics ?? {}).length > 0 || Object.keys(data.originLoadingExperience?.metrics ?? {}).length > 0;
    const field = Object.keys(data.loadingExperience?.metrics ?? {}).length ? data.loadingExperience : data.originLoadingExperience;
    const scope = field === data.loadingExperience ? "URL" : "origin";
    for (const [id, name, unit, scale] of [["LARGEST_CONTENTFUL_PAINT_MS", "LCP", "ms", 1], ["INTERACTION_TO_NEXT_PAINT", "INP", "ms", 1], ["CUMULATIVE_LAYOUT_SHIFT_SCORE", "CLS", "", 100]] as const) {
      const metric = field?.metrics?.[id];
      if (typeof metric?.percentile === "number" && Number.isFinite(metric.percentile)) metrics.push({ name: `Field ${scope} ${name} (75th percentile)`, value: `${metric.percentile / scale}${unit ? ` ${unit}` : ""}${typeof metric.category === "string" ? ` · ${metric.category}` : ""}` });
    }
    return json({ url: url.href, strategy, fetchedAt: new Date().toISOString(), performanceScore, metrics, fieldDataAvailable,
      warning: ["The performance score and Lab metrics are Lighthouse measurements. Field metrics, when returned, are Chrome UX Report 75th-percentile measurements.", !fieldDataAvailable ? "No Chrome UX Report field data was returned." : `Field data scope: ${scope}; origin-level data does not describe this specific page alone.`, performanceScore === null ? "Google did not return a valid performance score." : ""].filter(Boolean).join(" ") });
  };
  try { return await Promise.race([work(), timeout]); }
  catch { return json({ error: "PageSpeed could not complete within the response/time limits. No performance score was recorded." }, 502); }
  finally { clearTimeout(timer); controller.abort(); active--; }
}
