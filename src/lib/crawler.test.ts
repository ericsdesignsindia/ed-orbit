import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCrawlPage, parseRobots, robotsAllows, runCrawl, type CrawlDependencies } from "./crawler";
import type { SafeResponse } from "./safe-fetch";

test("robots group specificity, wildcard/end matching and longest allow", () => {
  const p = parseRobots("User-agent: *\nDisallow: /\nUser-agent: SEOCommandCenter\nDisallow: /private*\nAllow: /private/public$\nCrawl-delay: 1.5\nSitemap: https://example.com/map.xml");
  assert.equal(p.delayMs, 1500); assert.deepEqual(p.sitemaps, ["https://example.com/map.xml"]);
  for (const [path, allowed] of [["/", true], ["/private/a", false], ["/private/public", true], ["/private/public/a", false]] as const) assert.equal(robotsAllows(p, `https://example.com${path}`), allowed);
  const combined = parseRobots("User-agent: SEOCommandCenter\nDisallow: /one\nUser-agent: SEOCommandCenter\nDisallow: /two\nAllow: /two");
  assert.equal(robotsAllows(combined, "https://example.com/one"), false); assert.equal(robotsAllows(combined, "https://example.com/two"), true);
});
function harness(routes: Record<string, Partial<SafeResponse>>) {
  let time = Date.now(); const calls: { url: string; time: number }[] = [];
  const deps: CrawlDependencies = { now: () => time, sleep: async ms => { time += ms; }, resolve: async () => [{ address: "8.8.8.8", family: 4 }], transport: async url => { calls.push({ url: url.href, time }); return { url: url.href, status: 404, headers: { "content-type": "text/plain" }, body: "", ...routes[url.href] }; } };
  return { calls, deps };
}
const html = (body: string, status = 200): Partial<SafeResponse> => ({ status, headers: { "content-type": "text/html" }, body });
const title = "<head><title>Shared title</title><meta name='description' content='Shared description'></head>";
test("real injected results preserve HTTP www, discover sitemap and report only fetched broken links", async () => {
  const root = "http://www.example.com";
  const h = harness({ [`${root}/robots.txt`]: { status: 200, body: `User-agent: *\nDisallow: /private\nSitemap: ${root}/custom.xml` }, [`${root}/`]: html(`${title}<a href='/other'>next</a><a href='/missing'>broken</a><a href='/unknown' rel='nofollow'>skip</a><a href='https://outside.com/'>outside</a>`), [`${root}/other`]: html(title), [`${root}/custom.xml`]: { status: 200, body: `<urlset><url><loc>${root}/from-map</loc></url></urlset>` }, [`${root}/from-map`]: html("<title>Map page</title>"), [`${root}/missing`]: html("Missing", 404) });
  const r = await runCrawl(root, { maxPages: 10 }, h.deps);
  assert.equal(r.siteUrl, `${root}/`); assert.equal(h.calls[0].url, `${root}/robots.txt`);
  assert.equal(r.pages.length, 4); assert.ok(r.issues.some(i => i.code === "duplicate-title")); assert.ok(r.issues.some(i => i.code === "duplicate-description"));
  assert.ok(r.issues.some(i => i.code === "broken-internal-link" && i.detail.includes("/missing")));
  assert.ok(!h.calls.some(c => /outside|unknown/.test(c.url))); assert.equal(r.requests, h.calls.length);
  for (let i = 1; i < h.calls.length; i++) assert.ok(h.calls[i].time - h.calls[i - 1].time >= 250);
});
test("redirect policy checks target origin robots before page and rejects unrelated host", async () => {
  const h = harness({ "https://example.com/": { status: 301, headers: { location: "https://www.example.com/" } }, "https://www.example.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" } });
  const r = await runCrawl("example.com", {}, h.deps);
  assert.ok(h.calls.some(c => c.url === "https://www.example.com/robots.txt")); assert.ok(!h.calls.some(c => c.url === "https://www.example.com/")); assert.equal(r.pages[0].status, 0);
  const external = harness({ "https://example.com/": { status: 302, headers: { location: "https://attacker.com/" } } });
  await runCrawl("example.com", {}, external.deps); assert.ok(!external.calls.some(c => c.url.includes("attacker")));
});
test("robots 503 and excessive delay fail closed; absent policy permits", async () => {
  for (const robots of [{ status: 503 }, { status: 401 }, { status: 403 }, { status: 200, body: "User-agent: *\nCrawl-delay: 20" }]) {
    const h = harness({ "https://example.com/robots.txt": robots }); const r = await runCrawl("example.com", {}, h.deps);
    assert.equal(h.calls.length, 1); assert.equal(r.pages[0].status, 0); assert.ok(r.limitations.some(l => l.includes("failed closed")));
  }
});
test("page, query, sitemap depth and cancellation limits remain honest", async () => {
  const h = harness({ "https://example.com/": html("<a href='/a'>a</a><a href='/?trap=1'>trap</a>"), "https://example.com/sitemap.xml": { status: 200, body: "<sitemapindex><sitemap><loc>https://example.com/sitemap.xml</loc></sitemap></sitemapindex>" } });
  const r = await runCrawl("example.com", { maxPages: 1 }, h.deps); assert.equal(r.pages.length, 1); assert.ok(r.limitations.some(l => l.includes("Page cap"))); assert.ok(r.limitations.some(l => l.includes("Sitemap fetch/depth"))); assert.ok(!h.calls.some(c => c.url.includes("?")));
  await assert.rejects(runCrawl("example.com", { maxPages: 1.5 }), /integer/);
  const abort = new AbortController(); abort.abort(); const cancelled = await runCrawl("example.com", {}, { ...h.deps, signal: abort.signal }); assert.equal(cancelled.requests, 0); assert.ok(cancelled.limitations.some(l => l.includes("cancelled")));
});
test("DNS rebinding on a page hop cannot reach private transport", async () => {
  const h = harness({ "https://example.com/": html("<title>Page</title>") }); let n = 0;
  h.deps.resolve = async () => [{ address: ++n === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }];
  const r = await runCrawl("example.com", {}, h.deps); assert.equal(h.calls.length, 1); assert.equal(r.pages[0].status, 0);
});

test("common apex-to-www robots redirects remain safe and do not block authorized canonical crawling", async () => {
  const h = harness({
    "https://example.com/robots.txt": { status: 301, headers: { location: "https://www.example.com/robots.txt" } },
    "https://www.example.com/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" },
    "https://example.com/": { status: 301, headers: { location: "https://www.example.com/" } },
    "https://www.example.com/": html("<title>Canonical homepage</title>"),
  });
  const result = await runCrawl("https://example.com", { maxPages: 1 }, h.deps);
  assert.equal(result.pages[0].status, 200);
  assert.equal(result.pages[0].finalUrl, "https://www.example.com/");
});

test("crawl retains image-alt, viewport and HTTPS diagnostics", () => {
  const result = analyzeCrawlPage({ url: "http://example.com/", status: 200, headers: { "content-type": "text/html" }, body: "<title>Homepage</title><img src='a'><img src='decorative' alt=''>" });
  assert.ok(result.issues.some(issue => issue.code === "missing-image-alt" && issue.detail.startsWith("1 image")));
  assert.ok(result.issues.some(issue => issue.code === "viewport"));
  assert.ok(result.issues.some(issue => issue.code === "http-not-https"));
});
