import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

const COOKIE = "seo_access";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function validSession(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;
  const [expires, supplied, ...extra] = value.split(".");
  if (extra.length || !/^\d{10,13}$/.test(expires) || !supplied) return false;
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry > Date.now() + 7 * 24 * 60 * 60 * 1000 + 60_000) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expires))));
  if (signature.length !== supplied.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) mismatch |= signature.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  // The sample SIGNAL tour is intentionally public and contains no real client data.
  if (request.nextUrl.pathname === "/demo" || request.nextUrl.pathname === "/signal-logo-landscape.jpg") return NextResponse.next();
  if (clerkReady()) return clerkHandler(request, event);
  if (process.env.VERCEL !== "1") return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === "/api/auth" || pathname === "/api/cron" || pathname === "/login" || pathname === "/setup" || pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname === "/icon.png" || pathname === "/apple-icon.png" || pathname === "/robots.txt") return NextResponse.next();
  const password = process.env.SEO_ACCESS_PASSWORD;
  if (!password || password.length < 16) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "SEO access has not been configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.redirect(new URL("/setup", request.url));
  }
  if (await validSession(request.cookies.get(COOKIE)?.value, password)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

function clerkReady() {
  // Clerk stays dormant until every persistent workspace and integration vault
  // is organization-scoped. This prevents new accounts from sharing old data.
  return process.env.CLERK_AUTH_ENABLED === "1" && process.env.CLERK_ORG_STORAGE_READY === "1" && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
}

const clerkHandler = clerkMiddleware(async (auth, request) => {
  const path = request.nextUrl.pathname;
  if (path === "/api/cron" || path.startsWith("/sign-in") || path.startsWith("/sign-up") || path === "/setup") return;
  const { userId, orgId, redirectToSignIn } = await auth();
  if (!userId) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return redirectToSignIn({ returnBackUrl: request.url });
  }
  if (!orgId && path !== "/onboarding") {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Choose an organization before accessing workspace data." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }
});

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
