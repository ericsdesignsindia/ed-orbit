import test from "node:test";
import assert from "node:assert/strict";
import { createStore, isGoogleReport } from "./store";
import { googleReport } from "./google";
import { compareIssues, createRunner } from "./jobs";
import { normalizeWebsiteUrl } from "./site-url";
import { readWorkspaceBody } from "./api-security";
import type { CrawlResult, SeoIssue } from "./contracts";
import { addLiveWebsite, emptyWorkspace, recordAudit } from "./live-workspace";

test("enriched Google API results persist unchanged and execute in the background runner", async t => {
  t.mock.method(globalThis, "fetch", async (target: string | URL | Request, init?: RequestInit) => {
    if (String(target).includes("analyticsdata")) return Response.json({ rows: [{ metricValues: ["20", "30", "60", "4"].map(value => ({ value })) }] });
    const request = JSON.parse(String(init?.body)) as { dimensions: string[]; startDate: string };
    const key = request.dimensions[0] === "date" ? request.startDate : request.dimensions[0] === "page" ? "https://example.com/page" : "test query";
    return Response.json({ rows: [{ keys: [key], clicks: 4, impressions: 500, position: 3 }] });
  });
  const store = createStore();
  try {
    const state = store.dispatch({ action: "add-site", url: "https://example.com", name: "Integration fixture" });
    const site = state.sites[0];
    store.dispatch({ action: "update-site", id: site.id, bindings: { siteUrl: "sc-domain:example.com", propertyId: "123" } });
    const report = await googleReport("offline-fixture", { siteUrl: "sc-domain:example.com", propertyId: "123", days: 30 });
    assert.ok(isGoogleReport(report), "new Google report schema is accepted by durable storage");
    assert.equal(report.ga4?.trafficScope, "organic-search");
    assert.equal(report.ga4?.keyEvents, 4);
    assert.ok(report.queries?.length && report.pages?.length && report.opportunities?.length);
    const saved = store.dispatch({ action: "save-report", websiteId: site.id, days: 30, data: report });
    assert.deepEqual(saved.reports[0].data, report);
    store.enqueueJob({ websiteId: site.id, kind: "report" });
    const runner = createRunner(store, { report: input => googleReport("offline-fixture", input) });
    await runner.tick();
    const completed = store.getSnapshot();
    assert.equal(completed.jobs[0].status, "success");
    assert.equal(completed.reports.length, 2);
    assert.equal(completed.reports[0].data.ga4?.keyEvents, 4);
    assert.equal(isGoogleReport({ ...report, accessToken: "must-not-be-in-backup" }), false);
  } finally { store.close(); }
});

test("unvisited pages and incomplete cross-page checks are not falsely resolved", () => {
  const issue: SeoIssue = { id: "issue1", code: "missing-title", title: "Title", severity: "warning", url: "https://example.com/old", detail: "Missing", recommendation: "Add" };
  assert.equal(compareIssues([], [issue], new Set(["https://example.com/"]), false)[0].change, "not-rechecked");
  assert.equal(compareIssues([], [issue], new Set([issue.url]), false)[0].change, "resolved");
  assert.equal(compareIssues([], [{ ...issue, code: "duplicate-title" }], new Set([issue.url]), false)[0].change, "not-rechecked");
  assert.equal(compareIssues([], [{ ...issue, code: "duplicate-title" }], new Set([issue.url]), true)[0].change, "resolved");
});

test("background traffic checks retry transient missing sources but do not declare a healthy result", async () => {
  const store = createStore();
  try {
    const state = store.dispatch({ action: "add-site", url: "example.com" });
    store.enqueueJob({ websiteId: state.sites[0].id, kind: "traffic-alert" });
    const runner = createRunner(store, { report: async () => ({ startDate: "2026-09-01", endDate: "2026-09-30", errors: ["Google temporarily unavailable"], retryable: true }) });
    await runner.tick(); assert.equal(store.getSnapshot().jobs[0].status, "queued");
    await runner.tick(); await runner.tick();
    const final = store.getSnapshot();
    assert.equal(final.jobs[0].status, "failed");
    assert.equal(final.reports.length, 0);
  } finally { store.close(); }
});

test("valid large reports are accepted as bodies while arbitrary large mutations are rejected", async () => {
  const payload = "x".repeat(300000);
  const request = (action: string) => new Request("http://localhost:3000/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data: payload }) });
  assert.ok(await readWorkspaceBody(request("save-report")));
  await assert.rejects(readWorkspaceBody(request("add-site")), /too large/);
});

test("website normalization preserves entered host scheme and paths", () => {
  assert.equal(normalizeWebsiteUrl("http://www.example.com/blog/#top"), "http://www.example.com/blog/");
  assert.equal(normalizeWebsiteUrl("www.example.com"), "https://www.example.com/");
  assert.throws(() => normalizeWebsiteUrl("http://127.0.0.1/"));
  assert.throws(() => normalizeWebsiteUrl("https://user:password@example.com"));
});

test("migration preserves failed run receipts and recovers www from an explicit legacy property", () => {
  let old = addLiveWebsite(emptyWorkspace(), "www.example.com", "Legacy site");
  old.bindings[old.selectedId] = { siteUrl: "https://www.example.com/", propertyId: "123" };
  old = recordAudit(old, { id: "legacy-run", websiteId: old.selectedId, startedAt: "2026-10-10T00:00:00.000Z", completedAt: "2026-10-10T00:00:01.000Z", status: "failed", error: "Website unavailable" });
  const original = JSON.stringify(old);
  const store = createStore();
  try {
    const imported = store.dispatch({ action: "import-legacy", raw: original });
    assert.equal(imported.sites[0].url, "https://www.example.com/");
    assert.equal(imported.jobs[0].id, "legacy-run");
    assert.equal(imported.jobs[0].status, "failed");
    assert.equal(imported.jobs[0].error, "Website unavailable");
    assert.equal(JSON.stringify(old), original);
  } finally { store.close(); }
});

test("runner stores a real injected crawl and correctly tracks issue lifecycle across a partial run", async () => {
  const store = createStore();
  try {
    const site = store.dispatch({ action: "add-site", url: "https://example.com" }).sites[0];
    const issue: SeoIssue = { id: "stable-id", code: "missing-title", title: "Missing title", severity: "warning", url: "https://example.com/second", detail: "Evidence", recommendation: "Fix" };
    let first = true;
    const runner = createRunner(store, { crawl: async (): Promise<CrawlResult> => ({ id: first ? "crawl-first" : "crawl-next", siteUrl: site.url, startedAt: "2026-10-10T00:00:00.000Z", completedAt: "2026-10-10T00:01:00.000Z", score: 92, requests: 3, limitations: [], pages: [{ url: first ? issue.url : site.url, finalUrl: first ? issue.url : site.url, status: 200, title: "", description: "", canonical: "", h1Count: 1, noindex: false, internalLinks: [], redirectCount: 0 }], issues: first ? [issue] : [] }) });
    store.enqueueJob({ websiteId: site.id, kind: "audit" }); await runner.tick();
    first = false;
    store.enqueueJob({ websiteId: site.id, kind: "audit" }); await runner.tick();
    assert.equal(store.getSnapshot().crawls[0].issues[0].change, "not-rechecked");
  } finally { store.close(); }
});
