import test from "node:test";
import assert from "node:assert/strict";
import { createStore, validateSnapshot } from "./store";
import { createRunner, compareIssues, trafficMessage } from "./jobs";
import { assertWorkspaceRequest, readWorkspaceBody } from "./api-security";
import type { CrawlResult, SeoIssue } from "./contracts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const addSite = (store: ReturnType<typeof createStore>, name = "example.com") => store.dispatch({ action: "add-site", url: name }).sites.at(-1)!;
const crawl = (siteUrl: string): CrawlResult => ({ id: crypto.randomUUID(), siteUrl, startedAt: "2026-10-10T00:00:00Z", completedAt: "2026-10-10T00:01:00Z", score: 90, pages: [], issues: [], limitations: [], requests: 1 });

test("SQLite snapshots persist across reopen and damaged databases are not reset", () => {
  const directory = mkdtempSync(join(tmpdir(), "omnirush", "orbit-test-"));
  const path = join(directory, "test.sqlite");
  try {
    const initial = createStore(path); const site = addSite(initial); const revision = initial.getSnapshot().revision; initial.close();
    const reopened = createStore(path); assert.equal(reopened.getSnapshot().sites[0].id, site.id); assert.equal(reopened.getSnapshot().revision, revision); reopened.close();
    writeFileSync(path, "deliberately damaged test database"); const before = readFileSync(path);
    assert.throws(() => createStore(path)); assert.deepEqual(readFileSync(path), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("invalid restore rolls back; valid restore creates recovery snapshot and disables execution", () => {
  const store = createStore();
  try {
    const site = addSite(store); const before = store.getSnapshot();
    assert.throws(() => store.dispatch({ action: "restore", backup: { ...before, sites: [{ ...site, bindings: { accessToken: "do-not-store" } }] }, confirmed: true }));
    assert.deepEqual(store.getSnapshot(), before); assert.equal(store.recoveryCount(), 0);
    store.enqueueJob({ websiteId: site.id, kind: "audit" });
    const backup = store.getSnapshot();
    store.dispatch({ action: "restore", backup, confirmed: true });
    assert.equal(store.recoveryCount(), 1); assert.equal(store.getSnapshot().jobs[0].status, "failed");
    assert.ok(store.getSnapshot().revision > backup.revision);
  } finally { store.close(); }
});
test("migration preserves more than 100 sites, rejects invalid data without setting flag, caps admission", () => {
  const store = createStore();
  try {
    assert.throws(() => store.dispatch({ action: "import-legacy", raw: "{bad" }));
    assert.equal(store.getSnapshot().migrationComplete, false);
    const websites = Array.from({ length: 500 }, (_, n) => ({ id: `site-${n}`, name: `Site ${n}`, domain: `site${n}.example.com` }));
    store.dispatch({ action: "import-legacy", raw: JSON.stringify({ version: 1, websites, selectedId: "site-0", audits: [], runs: [], bindings: {} }) });
    assert.equal(store.getSnapshot().sites.length, 500); assert.equal(store.getSnapshot().migrationComplete, true);
    assert.throws(() => addSite(store, "overflow.example.com"));
    assert.throws(() => store.dispatch({ action: "import-legacy", raw: "{}" }));
  } finally { store.close(); }
});
test("valid legacy audit history becomes saved crawls", () => {
  const store = createStore();
  try {
    store.dispatch({ action: "import-legacy", raw: JSON.stringify({ version: 1, websites: [{ id: "one", name: "Example", domain: "example.com" }], selectedId: "one", bindings: {}, runs: [], audits: [{ id: "old-audit", domain: "example.com", url: "https://example.com/", scannedAt: "2026-10-01T00:00:00Z", score: 70, pagesChecked: 1, durationMs: 50, checks: [{ id: "title", title: "Title", status: "fail", detail: "Missing title" }] }] }) });
    const saved = store.getSnapshot().crawls[0]; assert.equal(saved.id, "old-audit"); assert.equal(saved.issues[0].severity, "critical");
  } finally { store.close(); }
});
test("actions reject execution fields and website duplication; deletes cascade and queued deletes fail", () => {
  const store = createStore();
  try {
    const site = addSite(store);
    assert.throws(() => addSite(store));
    assert.throws(() => store.dispatch({ action: "enqueue", websiteId: site.id, kind: "audit", attempt: 0 }));
    store.enqueueJob({ websiteId: site.id, kind: "audit" });
    assert.throws(() => store.dispatch({ action: "delete-site", id: site.id, confirmed: true }));
    store.mutate(s => { s.jobs[0].status = "success"; });
    store.dispatch({ action: "save-schedule", schedule: { websiteId: site.id, kind: "report" } });
    store.dispatch({ action: "update-site", id: site.id, archived: true }); assert.equal(store.getSnapshot().schedules[0].enabled, false);
    store.dispatch({ action: "delete-site", id: site.id, confirmed: true });
    assert.equal(store.getSnapshot().jobs.length, 0); assert.equal(store.getSnapshot().schedules.length, 0);
  } finally { store.close(); }
});
test("per-site retention protects other website history", () => {
  const store = createStore();
  try {
    const one = addSite(store); const two = addSite(store, "other.example.com");
    store.mutate(s => { s.crawls = [{ ...crawl(two.url), websiteId: two.id }, ...Array.from({ length: 40 }, () => ({ ...crawl(one.url), websiteId: one.id }))]; });
    assert.equal(store.getSnapshot().crawls.filter(x => x.websiteId === one.id).length, 30);
    assert.equal(store.getSnapshot().crawls.filter(x => x.websiteId === two.id).length, 1);
    assert.throws(() => validateSnapshot({ ...store.getSnapshot(), runner: { active: false, localOnly: true, token: "secret" } }));
  } finally { store.close(); }
});
test("worker serializes transitions, retries transient failures up to three and recovers interruption", async () => {
  const store = createStore();
  try {
    const site = addSite(store); store.enqueueJob({ websiteId: site.id, kind: "audit" });
    let calls = 0;
    const runner = createRunner(store, { crawl: async () => { calls++; assert.equal(store.getSnapshot().jobs[0].status, "running"); if (calls < 3) throw Object.assign(new Error("sensitive upstream"), { status: 503 }); return crawl(site.url); } });
    await runner.tick(); assert.equal(store.getSnapshot().jobs[0].status, "queued");
    await runner.tick(); assert.equal(store.getSnapshot().jobs[0].attempt, 2);
    await runner.tick(); assert.equal(store.getSnapshot().jobs[0].status, "success"); assert.equal(store.getSnapshot().crawls.length, 1);
    store.enqueueJob({ websiteId: site.id, kind: "audit" }); store.mutate(s => { s.jobs[0].status = "running"; s.jobs[0].attempt = 1; });
    await createRunner(store, { crawl: async () => crawl(site.url) }).tick(); assert.equal(store.getSnapshot().jobs[0].status, "success"); assert.equal(store.getSnapshot().jobs[0].attempt, 2);
  } finally { store.close(); }
});
test("schedule misfires enqueue only one catchup and SMTP failure never repeats audit", async () => {
  const store = createStore();
  try {
    const site = addSite(store); store.dispatch({ action: "save-schedule", schedule: { websiteId: site.id, kind: "audit", notificationEmail: "owner@example.com" } });
    store.mutate(s => { s.schedules[0].nextRunAt = "2026-01-01T00:00:00Z"; });
    let calls = 0;
    const runner = createRunner(store, { now: () => new Date("2026-10-10T10:00:00Z"), crawl: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return crawl(site.url); }, email: async () => { throw new Error("SMTP secret"); } });
    await Promise.all([runner.tick(), runner.tick()]); await runner.tick();
    const s = store.getSnapshot(); assert.equal(calls, 1); assert.equal(s.jobs.length, 1); assert.equal(s.jobs[0].status, "success"); assert.equal(s.notifications[0].emailStatus, "failed"); assert.equal(s.schedules[0].nextRunAt, "2026-10-11T03:30:00.000Z");
    assert.equal(JSON.stringify(s).includes("SMTP secret"), false);
  } finally { store.close(); }
});
test("three transient failures stop retries and leave an in-app notification without upstream secrets", async () => {
  const store = createStore();
  try {
    const site = addSite(store); store.enqueueJob({ websiteId: site.id, kind: "audit" });
    let attempts = 0;
    const runner = createRunner(store, { crawl: async () => { attempts++; throw Object.assign(new Error("secret upstream response"), { status: 503 }); } });
    for (let n = 0; n < 4; n++) await runner.tick();
    assert.equal(attempts, 3); assert.equal(store.getSnapshot().jobs[0].status, "failed"); assert.equal(store.getSnapshot().notifications.length, 1);
    assert.equal(JSON.stringify(store.getSnapshot()).includes("secret upstream"), false);
  } finally { store.close(); }
});
test("traffic alerts require meaningful comparable volume; resolved issues remain visible", () => {
  const report = { startDate: "2026-10-01", endDate: "2026-10-07", gsc: { clicks: 50, impressions: 100, ctr: 0.5, position: 2, rows: [] } };
  assert.match(trafficMessage(report, { minClicks: 100, dropPercent: 30 }), /no alert/);
  assert.match(trafficMessage({ ...report, comparison: { startDate: "2026-09-24", endDate: "2026-09-30", previous: { clicks: 200, impressions: 1000, ctr: 0.2, position: 2 }, changes: { clicksPercent: -75, impressionsPercent: -90 } } }, { minClicks: 100, dropPercent: 30 }), /Traffic alert/);
  const issue: SeoIssue = { id: "stable", code: "title", title: "Missing", severity: "warning", url: "https://example.com/", detail: "missing", recommendation: "add" };
  assert.equal(compareIssues([issue], [issue])[0].change, "ongoing"); assert.equal(compareIssues([], [issue])[0].change, "resolved");
});
test("workspace API guards reject cross origin and execution-size payloads", async () => {
  assert.throws(() => assertWorkspaceRequest(new Request("http://localhost:3000/api/workspace", { headers: { host: "attacker.example", origin: "http://attacker.example" } }), true));
  assert.throws(() => assertWorkspaceRequest(new Request("http://localhost:3000/api/workspace", { headers: { host: "localhost:3000", origin: "https://evil.example" } }), true));
  assertWorkspaceRequest(new Request("http://localhost:3000/api/workspace", { headers: { host: "localhost:3000", origin: "http://localhost:3000" } }), true);
  await assert.rejects(readWorkspaceBody(new Request("http://localhost/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enqueue", extra: "x".repeat(300000) }) })), /too large/);
});
