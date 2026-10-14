import test from "node:test";
import assert from "node:assert/strict";
import { addLiveWebsite, emptyWorkspace, isAudit, parseLiveWorkspace, recordAudit } from "./live-workspace";
import type { AuditResult } from "./audit";

const fixture = (): AuditResult => ({ id: "audit-1", domain: "example.com", url: "https://example.com/", scannedAt: "2026-10-10T00:00:00.000Z", score: 50, checks: [{ id: "title", title: "Page title", status: "warning", detail: "Missing title", recommendation: "Add a descriptive title." }], pagesChecked: 1, durationMs: 123 });

test("live workspace starts empty with no fabricated metrics or example sites", () => {
  assert.deepEqual(parseLiveWorkspace(null), emptyWorkspace());
  const initial = emptyWorkspace();
  const added = addLiveWebsite(initial, "https://www.example.com/page", "My website");
  assert.equal(initial.websites.length, 0);
  assert.equal(added.websites[0].domain, "example.com");
  assert.equal(added.selectedId, added.websites[0].id);
  assert.equal(added.audits.length, 0);
  assert.throws(() => addLiveWebsite(added, "example.com", "Duplicate"), /already/);
  assert.throws(() => addLiveWebsite(added, "localhost", "Private"));
});

test("real completed audit and run survive serialization and rereading", () => {
  const state = addLiveWebsite(emptyWorkspace(), "example.com", "My site");
  const audit = fixture();
  const saved = recordAudit(state, { id: "run-1", websiteId: state.selectedId, startedAt: audit.scannedAt, completedAt: audit.scannedAt, status: "success", auditId: audit.id }, audit);
  saved.bindings[state.selectedId] = { siteUrl: "sc-domain:example.com", propertyId: "123456" };
  assert.equal(state.runs.length, 0);
  assert.deepEqual(parseLiveWorkspace(JSON.stringify(saved)), saved);
  assert.equal(parseLiveWorkspace(JSON.stringify(saved)).audits[0].checks[0].detail, "Missing title");
});

test("failed runs cannot create successful audits; mismatched successes are rejected", () => {
  const state = addLiveWebsite(emptyWorkspace(), "example.com", "My site");
  const run = { id: "run-1", websiteId: state.selectedId, startedAt: fixture().scannedAt, completedAt: fixture().scannedAt, status: "failed" as const, error: "Network unavailable" };
  const failed = recordAudit(state, run);
  assert.equal(failed.audits.length, 0);
  assert.equal(parseLiveWorkspace(JSON.stringify(failed)).runs[0].status, "failed");
  assert.throws(() => recordAudit(state, { ...run, status: "success" }), /does not match/);
  assert.throws(() => recordAudit(state, { ...run, status: "success", auditId: "audit-1" }, { ...fixture(), domain: "different.com" }), /does not match/);
});

test("malformed persistence is rejected and run retention is bounded", () => {
  const state = addLiveWebsite(emptyWorkspace(), "example.com", "My site");
  for (const raw of ["{", JSON.stringify({ ...state, selectedId: "missing" }), JSON.stringify({ ...state, audits: [{ ...fixture(), checks: [{ status: "pass" }] }] }), JSON.stringify({ ...state, bindings: { [state.selectedId]: { propertyId: 123 } } })]) assert.deepEqual(parseLiveWorkspace(raw), emptyWorkspace());
  let saved = state;
  for (let i = 0; i < 55; i++) saved = recordAudit(saved, { id: `run-${i}`, websiteId: state.selectedId, startedAt: fixture().scannedAt, completedAt: fixture().scannedAt, status: "failed", error: "Unavailable" });
  assert.equal(saved.runs.length, 50);
  assert.equal(saved.runs[0].id, "run-54");
  assert.deepEqual(parseLiveWorkspace(JSON.stringify(saved)), saved);
  assert.equal(isAudit({ ...fixture(), score: Infinity }), false);
});
