import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHomepage, runAudit } from "./audit";
import type { SafeResponse } from "./safe-fetch";
import { POST } from "../app/api/audit/route";

const html = `<!doctype html><html><head><title>A helpful homepage title</title><meta name="description" content="A helpful description of this homepage that gives visitors enough context to understand its purpose."><link rel="canonical" href="/"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Welcome</h1><img src="decorative.png" alt=""><img src="photo.png"></body></html>`;
test("static fixture extraction reports missing alt without penalizing decorative empty alt", () => {
  const checks = analyzeHomepage(html, "https://example.com/");
  for (const id of ["title", "description", "canonical", "h1", "viewport", "https", "indexability"]) assert.equal(checks.find((check) => check.id === id)?.status, "pass", id);
  assert.equal(checks.find((check) => check.id === "image-alt")?.status, "warning");
  assert.match(checks.find((check) => check.id === "image-alt")!.detail, /2 image\(s\); 1 missing/);
});
test("noindex in metadata or headers is detected and absent markup is not fabricated", () => {
  for (const [body, headers] of [["<meta name='robots' content='noindex,follow'>", {}], ["", { "x-robots-tag": "googlebot: noindex" }]] as const) assert.equal(analyzeHomepage(body, "https://example.com", headers).find((check) => check.id === "indexability")?.status, "fail");
  const checks = analyzeHomepage("<p>Blank page</p>", "http://example.com");
  assert.equal(checks.find((check) => check.id === "title")?.status, "warning");
  assert.equal(checks.find((check) => check.id === "https")?.status, "warning");
});
test("audit fetches three resources using final homepage origin, distinguishes unknown from absent", async () => {
  const calls: string[] = [];
  const result = await runAudit("example.com", async (url): Promise<SafeResponse> => {
    calls.push(url);
    if (url.endsWith("robots.txt")) throw new Error("Private transport detail");
    if (url.endsWith("sitemap.xml")) return { url, status: 404, headers: {}, body: "" };
    return { url: "https://www.example.com/", status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html };
  });
  assert.deepEqual(calls, ["https://example.com/", "https://www.example.com/robots.txt", "https://www.example.com/sitemap.xml"]);
  assert.equal(result.pagesChecked, 1);
  assert.equal(result.checks.find((check) => check.id === "robots")?.status, "info");
  assert.equal(result.checks.find((check) => check.id === "sitemap")?.status, "warning");
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(!JSON.stringify(result).includes("Private transport detail"));
});
test("homepage failure, error status, or non-HTML is not a successful audit", async () => {
  await assert.rejects(runAudit("example.com", async () => { throw new Error("secret network details"); }), /could not be retrieved safely/);
  await assert.rejects(runAudit("example.com", async (url) => ({ url, status: 503, headers: {}, body: "" })), /HTTP 503/);
  await assert.rejects(runAudit("example.com", async (url) => ({ url, status: 200, headers: { "content-type": "application/json" }, body: "{}" })), /content type/);
});
test("homepage audit preserves submitted HTTP and www host", async () => {
  const calls: string[] = [];
  const result = await runAudit("http://www.example.com/", async url => { calls.push(url); return { url, status: 200, headers: { "content-type": "text/html" }, body: html }; });
  assert.equal(calls[0], "http://www.example.com/"); assert.equal(result.domain, "www.example.com"); assert.equal(result.url, "http://www.example.com/");
});
test("PageSpeed rejects cross-origin and private syntax without external requests", async () => {
  const { POST: pagespeed } = await import("../app/api/pagespeed/route");
  const previous = process.env.APP_BASE_URL; delete process.env.APP_BASE_URL;
  try {
    const request = (origin: string, body: string) => new Request("http://localhost:3000/api/pagespeed", { method: "POST", headers: { host: "localhost:3000", origin, "content-type": "application/json" }, body });
    assert.equal((await pagespeed(request("https://outside.com", '{"url":"example.com","strategy":"mobile"}'))).status, 403);
    assert.equal((await pagespeed(request("http://localhost:3000", '{"url":"http://127.0.0.1","strategy":"mobile"}'))).status, 400);
    assert.equal((await pagespeed(request("http://localhost:3000", '{"url":"example.com","strategy":"invalid"}'))).status, 400);
  } finally { if (previous === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previous; }
});

test("API rejects cross-origin, non-JSON, oversized and invalid-domain input before network access", async () => {
  const previous = process.env.APP_BASE_URL;
  delete process.env.APP_BASE_URL;
  try {
    const request = (body: string, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/audit", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", ...headers }, body });
    const forbidden = await POST(request('{"domain":"example.com"}', { origin: "https://attacker.example" }));
    assert.equal(forbidden.status, 403); assert.equal(forbidden.headers.get("cache-control"), "no-store");
    assert.equal((await POST(request("{}", { "content-type": "text/plain" }))).status, 415);
    assert.equal((await POST(request("x".repeat(2049)))).status, 400);
    assert.equal((await POST(request('{"domain":"127.0.0.1"}'))).status, 400);
    assert.equal((await POST(request('{"domain":42}'))).status, 400);
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
});
