import { runAudit } from "../../../lib/audit";
import { normalizeWebsiteUrl } from "../../../lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY = 2048;
let active = 0;
const recent: number[] = [];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function trustedRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    if (process.env.VERCEL === "1") {
      const host = request.headers.get("host");
      return !!host && ["http:", "https:"].includes(url.protocol) && url.host.toLowerCase() === host.toLowerCase() && request.headers.get("origin") === url.origin && request.headers.get("sec-fetch-site") !== "cross-site";
    }
    const configured = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : undefined;
    const allowed = configured ? [configured] : ["http://localhost:3000", "http://127.0.0.1:3000"];
    const host = request.headers.get("host");
    if (!host) return false;
    const browserOrigin = new URL(`${url.protocol}//${host}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(browserOrigin.hostname) &&
      browserOrigin.host === host && allowed.includes(browserOrigin.origin) &&
      request.headers.get("origin") === browserOrigin.origin;
  } catch { return false; }
}

async function readBody(request: Request): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new Error("Request body is too large.");
  if (!request.body) throw new Error("A JSON request body is required.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new Error("Request body timed out.")); }, 5000); });
  try {
    return await Promise.race([deadline, (async () => {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) { void reader.cancel(); throw new Error("Request body is too large."); }
        chunks.push(value);
      }
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.length > MAX_BODY) throw new Error("Request body is too large.");
      return text;
    })()]);
  } finally { clearTimeout(timer!); }
}

export async function POST(request: Request): Promise<Response> {
  if (!trustedRequest(request)) return json({ error: "Only same-origin requests from the app are allowed." }, 403);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) return json({ error: "Use application/json." }, 415);
  const now = Date.now();
  while (recent.length && recent[0] <= now - 60000) recent.shift();
  if (active >= 2 || recent.length >= 6) return json({ error: "Audit limit reached. Please wait a minute and try again." }, 429);
  recent.push(now); active++;
  try {
    let domain: string;
    try {
      const body: unknown = JSON.parse(await readBody(request));
      if (!body || typeof body !== "object" || !("domain" in body) || typeof body.domain !== "string" || body.domain.length > 1024) return json({ error: "Provide a valid domain string." }, 400);
      domain = normalizeWebsiteUrl(body.domain);
    } catch { return json({ error: "Provide a small JSON body with a valid public domain." }, 400); }
    try { return json(await runAudit(domain)); }
    catch { return json({ error: "The homepage could not be audited. It may be unreachable, blocked, unsafe, or not an HTML page. No successful scan was recorded." }, 502); }
  } finally { active--; }
}
