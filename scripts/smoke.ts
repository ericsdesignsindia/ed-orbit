import assert from "node:assert/strict";
import { addLiveWebsite, emptyWorkspace, recordAudit, parseLiveWorkspace, isAudit } from "../src/lib/live-workspace";

// Explicit opt-in network smoke check. Start the local app before running.
async function main() {
  const base = "http://localhost:3000";
  const response = await fetch(`${base}/api/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ domain: "example.com" }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, "Public example.com homepage must be reachable for this smoke check");
  const audit: unknown = await response.json();
  assert.ok(isAudit(audit));
  const state = addLiveWebsite(emptyWorkspace(), "example.com", "Smoke check");
  const saved = recordAudit(state, { id: "smoke-run", websiteId: state.selectedId, startedAt: audit.scannedAt, completedAt: audit.scannedAt, status: "success", auditId: audit.id }, audit);
  assert.deepEqual(parseLiveWorkspace(JSON.stringify(saved)), saved);
  const denied = await fetch(`${base}/api/audit`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: "{}" });
  assert.equal(denied.status, 403);
  console.log("PASS: production live audit, full persistence round-trip, and cross-origin rejection");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Smoke check failed"); process.exitCode = 1; });
