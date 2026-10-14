import assert from "node:assert/strict";
import test from "node:test";
import { addWebsite, createInitialWorkspace, normalizeDomain, parseWorkspace, serializeWorkspace, simulateRun, toggleAutomation, STORAGE_KEY } from "./workspace";

test("initial workspaces are independent and clearly demo", () => {
  const first = createInitialWorkspace();
  assert.equal(first.websites[0].name, "Acme Studio");
  assert.equal(first.websites[0].domain, "example.com");
  assert.equal(first.websites[0].isDemo, true);
  assert.equal(first.automations.length, 4);
  assert.ok(STORAGE_KEY.length > 0);
  first.automations[0].enabled = false;
  assert.equal(createInitialWorkspace().automations[0].enabled, true);
});

test("domains canonicalize URLs, case, www, IDNs and a DNS trailing dot", () => {
  for (const input of ["example.com", " WWW.Example.COM ", "https://www.example.com/report?q=1#top", "http://example.com."]) {
    assert.equal(normalizeDomain(input), "example.com");
  }
  assert.equal(normalizeDomain("https://münich.de"), "xn--mnich-kva.de");
  assert.equal(normalizeDomain("blog.example.co.uk"), "blog.example.co.uk");
  assert.equal(normalizeDomain(`${"a".repeat(63)}.com`), `${"a".repeat(63)}.com`);
});

test("invalid, local, credentialed, numeric and unsupported targets are rejected", () => {
  const rejected = ["", " ", "localhost", "https://localhost", "my.local", "a.internal", "a.home.arpa", "a.test", "a.invalid", "a.onion", "127.0.0.1", "10.0.0.1", "192.168.1.1", "8.8.8.8", "2130706433", "0x7f000001", "127.1", "http://[::1]", "https://[2606:4700::1111]", "https://user:password@example.com", "https://@example.com", "ftp://example.com", "javascript:alert(1)", "//example.com", "example.com/path", "https://example.com:8080", "https://exa mple.com", "https://example.com\\@localhost", "-bad.com", "bad-.com", "bad_name.com", "a..com", "example.c", `${"a".repeat(64)}.com`, `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`];
  for (const input of rejected) assert.throws(() => normalizeDomain(input), input);
});

test("adding a site is immutable, selects it, and rejects canonical duplicates", () => {
  const original = createInitialWorkspace();
  const before = serializeWorkspace(original);
  const updated = addWebsite(original, "https://www.newsite.org/path", "  New site  ");
  assert.equal(serializeWorkspace(original), before);
  assert.equal(updated.websites.length, 2);
  assert.equal(updated.websites[1].domain, "newsite.org");
  assert.equal(updated.websites[1].name, "New site");
  assert.equal(updated.websites[1].isDemo, false);
  assert.equal(updated.selectedWebsiteId, updated.websites[1].id);
  assert.throws(() => addWebsite(updated, "NEWsite.org"), /already/);
  assert.throws(() => addWebsite(original, "www.example.com"), /already/);
  assert.throws(() => addWebsite(original, "newsite.org", "x".repeat(201)), /200/);
  assert.equal(addWebsite(original, "newsite.org", " ").websites[1].name, "newsite.org");
});

test("automation toggles are immutable and reject unknown IDs", () => {
  const original = createInitialWorkspace();
  const id = original.automations[0].id;
  const changed = toggleAutomation(original, id);
  assert.equal(changed.automations[0].enabled, false);
  assert.equal(original.automations[0].enabled, true);
  assert.deepEqual(toggleAutomation(changed, id), original);
  assert.throws(() => toggleAutomation(original, "missing"), /Unknown/);
});

test("runs are demo-only, linked to the selected site, capped, and immutable", () => {
  const original = addWebsite(createInitialWorkspace(), "newsite.org");
  const id = original.automations[0].id;
  let current = original;
  for (let count = 0; count < 55; count++) current = simulateRun(current, id);
  assert.equal(original.runs.length, 0);
  assert.equal(current.runs.length, 50);
  assert.equal(new Set(current.runs.map((run) => run.id)).size, 50);
  assert.ok(current.runs.every((run) => run.status === "demo" && run.websiteId === original.selectedWebsiteId && run.automationId === id));
  assert.match(current.runs[0].summary, /DEMO ONLY/);
  assert.match(current.runs[0].summary, /no external action was executed/i);
  assert.ok(Number.isFinite(Date.parse(current.runs[0].startedAt)));
  assert.throws(() => simulateRun(original, "missing"), /Unknown/);
  assert.throws(() => simulateRun(toggleAutomation(original, id), id), /Enable/);
  assert.throws(() => simulateRun({ ...original, selectedWebsiteId: "missing" }, id), /Select/);
});

test("valid state round trips including added websites, dismissals, and history", () => {
  let state = addWebsite(createInitialWorkspace(), "newsite.org");
  state = simulateRun(state, state.automations[0].id);
  state = toggleAutomation(state, state.automations[0].id);
  state = { ...state, dismissedOpportunityIds: ["improve-title"] };
  assert.deepEqual(parseWorkspace(serializeWorkspace(state)), state);
});

test("malformed persisted shapes and broken references reset the entire workspace", () => {
  const initial = createInitialWorkspace();
  const withRun = simulateRun(initial, initial.automations[0].id);
  const invalid = [
    null, "", "{", "null", "[]", "true", "{}",
    ...[
      { ...initial, version: 2 }, { ...initial, selectedWebsiteId: "missing" },
      { ...initial, websites: [] }, { ...initial, websites: [null] },
      { ...initial, websites: [{ ...initial.websites[0], isDemo: "true" }] },
      { ...initial, websites: [{ ...initial.websites[0], domain: "localhost" }] },
      { ...initial, websites: [{ ...initial.websites[0], domain: "WWW.EXAMPLE.COM" }] },
      { ...initial, websites: [initial.websites[0], initial.websites[0]] },
      { ...initial, websites: [initial.websites[0], { ...initial.websites[0], id: "other" }] },
      { ...initial, websites: [{ ...initial.websites[0], name: " " }] },
      { ...initial, automations: [] }, { ...initial, automations: [null] },
      { ...initial, automations: [{ ...initial.automations[0], enabled: 1 }] },
      { ...initial, automations: [initial.automations[0], initial.automations[0]] },
      { ...initial, automations: [{ ...initial.automations[0], description: null }] },
      { ...initial, dismissedOpportunityIds: [1] }, { ...initial, dismissedOpportunityIds: ["a", "a"] },
      { ...initial, runs: {} }, { ...initial, runs: [null] },
      ...[ { status: "success" }, { startedAt: "not-a-date" }, { startedAt: "2026-02-30T00:00:00.000Z" }, { websiteId: "missing" }, { automationId: "missing" }, { summary: "" } ].map((patch) => ({ ...withRun, runs: [{ ...withRun.runs[0], ...patch }] })),
      { ...withRun, runs: [withRun.runs[0], withRun.runs[0]] },
    ].map((value) => JSON.stringify(value)),
  ];
  for (const raw of invalid) assert.deepEqual(parseWorkspace(raw), initial, String(raw));
});

test("persisted extra properties are dropped and excessive valid history is capped", () => {
  const state = simulateRun(createInitialWorkspace(), "weekly-report");
  const raw = JSON.stringify({ ...state, unexpected: "ignored", runs: Array.from({ length: 60 }, (_, index) => ({ ...state.runs[0], id: `run-${index}`, extra: "ignored" })) });
  const restored = parseWorkspace(raw);
  assert.equal(restored.runs.length, 50);
  assert.equal("unexpected" in restored, false);
  assert.equal("extra" in restored.runs[0], false);
});
