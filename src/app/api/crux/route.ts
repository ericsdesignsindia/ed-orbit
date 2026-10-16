import { assertWorkspaceRequest } from "../../../lib/api-security";
import { normalizeWebsiteUrl } from "../../../lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
let active = 0;
const recent: number[] = [];

type CruxMetric = { percentiles?: { p75?: number | string }; histogram?: { start?: number | string; end?: number | string; density?: number }[] };
type CruxRecord = { key?: { url?: string; origin?: string; formFactor?: string }; metrics?: Record<string, CruxMetric>; collectionPeriod?: { firstDate?: { year?: number; month?: number; day?: number }; lastDate?: { year?: number; month?: number; day?: number } } };

async function readJsonLimited(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 4096) throw new Error("body-too-large");
  if (!request.body) throw new Error("invalid-json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error("body-too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { throw new Error("invalid-json"); }
}

function safeMetricName(name: string) { return name.replace(/[^a-z_]/g, ""); }
function label(value: number | string | undefined, metric: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Not returned";
  const thresholds = metric === "largest_contentful_paint" ? [2500, 4000] : metric === "interaction_to_next_paint" ? [200, 500] : [0.1, 0.25];
  const unit = metric === "cumulative_layout_shift" ? "" : " ms";
  const grade = numeric <= thresholds[0] ? "Good" : numeric <= thresholds[1] ? "Needs improvement" : "Poor";
  return `${numeric}${unit} · ${grade}`;
}

export async function POST(request: Request): Promise<Response> {
  try { assertWorkspaceRequest(request, true); } catch { return json({ error: "Only same-origin requests from this workspace are allowed." }, 403); }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return json({ error: "Use application/json." }, 415);
  if (!process.env.CRUX_API_KEY) return json({ error: "CrUX is not configured yet. Add the CRUX_API_KEY in Vercel Production." }, 503);
  const now = Date.now(); while (recent.length && recent[0] < now - 60000) recent.shift();
  if (active >= 3 || recent.length >= 30) return json({ error: "CrUX query limit reached. Try again in a minute." }, 429);
  active++; recent.push(now);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const body = await readJsonLimited(request) as { url?: unknown; strategy?: unknown };
    if (typeof body.url !== "string" || !["mobile", "desktop"].includes(String(body.strategy))) return json({ error: "Provide a public website URL and a mobile or desktop device." }, 400);
    let parsed: URL;
    try { parsed = new URL(normalizeWebsiteUrl(body.url)); } catch { return json({ error: "Provide a valid public website URL." }, 400); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) return json({ error: "Provide a public website URL." }, 400);
    const origin = parsed.origin;
    const formFactor = body.strategy === "mobile" ? "PHONE" : "DESKTOP";
    const metrics = ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"];
    const query = async (identifier: { url?: string; origin?: string }) => {
      const endpoint = new URL("https://chromeuxreport.googleapis.com/v1/records:queryRecord");
      endpoint.searchParams.set("key", process.env.CRUX_API_KEY!);
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ...identifier, formFactor, metrics }), signal: controller.signal, redirect: "error", cache: "no-store" });
      if (response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 429 ? "quota" : response.status === 403 ? "access" : "upstream"); }
      if (Number(response.headers.get("content-length")) > 256 * 1024) { await response.body?.cancel(); throw new Error("upstream"); }
      const text = await response.text();
      if (text.length > 256 * 1024) throw new Error("upstream");
      const payload = JSON.parse(text) as { record?: CruxRecord };
      return payload.record ?? null;
    };
    const page = await query({ url: parsed.href });
    const record = page ?? await query({ origin });
    if (!record) return json({ url: parsed.href, origin, formFactor, available: false, fetchedAt: new Date().toISOString(), metrics: [], collectionPeriod: null, scope: "page-and-origin" });
    const availableMetrics = metrics.flatMap(name => {
      const metric = record.metrics?.[name];
      const p75 = metric?.percentiles?.p75;
      if (p75 === undefined) return [];
      return [{ name: safeMetricName(name), p75: Number(p75), result: label(p75, name), histogram: (metric?.histogram ?? []).map(bin => ({ start: bin.start ?? 0, ...(bin.end !== undefined ? { end: bin.end } : {}), density: Number(bin.density ?? 0) })) }];
    });
    const date = (value?: { year?: number; month?: number; day?: number }) => value?.year && value.month && value.day ? `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}` : null;
    const first = date(record.collectionPeriod?.firstDate), last = date(record.collectionPeriod?.lastDate);
    return json({ url: parsed.href, origin, formFactor, available: true, fetchedAt: new Date().toISOString(), scope: page ? "page" : "origin", metrics: availableMetrics, collectionPeriod: first && last ? { first, last } : null });
  } catch (error) {
    const kind = error instanceof Error ? error.message : "upstream";
    return json({ error: kind === "body-too-large" ? "Request is too large." : kind === "invalid-json" ? "Request body must be valid JSON." : kind === "quota" ? "Google CrUX quota is temporarily unavailable. Try again later." : kind === "access" ? "Google rejected the CrUX API key. Confirm the Chrome UX Report API is enabled for that key." : "Google CrUX could not return data right now. Try again later." }, kind === "body-too-large" || kind === "invalid-json" ? 400 : kind === "quota" ? 429 : 502);
  } finally { clearTimeout(timer); controller.abort(); active--; }
}
