import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = "seo_access";
const ttlSeconds = 7 * 24 * 60 * 60;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function originIsValid(request: Request): boolean {
  const host = request.headers.get("host");
  let origin: URL;
  try { origin = new URL(request.url); } catch { return false; }
  return !!host && origin.host === host && request.headers.get("origin") === origin.origin && request.headers.get("sec-fetch-site") !== "cross-site";
}

function equalSecret(expected: string, supplied: unknown): boolean {
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  if (!originIsValid(request)) return Response.json({ error: "A same-origin request is required." }, { status: 403, headers });
  const secret = process.env.SEO_ACCESS_PASSWORD;
  if (!secret || secret.length < 16) return Response.json({ error: "SEO access has not been configured. Set a password of at least 16 characters in the Vercel project settings." }, { status: 503, headers });
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096) return Response.json({ error: "Invalid request." }, { status: 413, headers });
    input = JSON.parse(text);
  } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Invalid request." }, { status: 400, headers });
  const data = input as { action?: unknown; password?: unknown };
  if (data.action === "logout") {
    return Response.json({ ok: true }, { headers: { ...headers, "Set-Cookie": `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` } });
  }
  if (data.action !== "login" || !equalSecret(secret, data.password)) return Response.json({ error: "The password is incorrect." }, { status: 401, headers });
  const expires = String(Date.now() + ttlSeconds * 1000);
  const signature = createHmac("sha256", secret).update(expires).digest("base64url");
  const cookie = `${cookieName}=${expires}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
  return Response.json({ ok: true }, { headers: { ...headers, "Set-Cookie": cookie } });
}
