import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, access } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { AppSnapshot, WorkspaceAction } from "../src/lib/contracts";

/** Isolated real-server verification. Never uses the user's .data directory. */
async function main() {
  const parent = path.join(os.tmpdir(), "omnirush");
  await access(parent);
  const dataDirectory = await mkdtemp(path.join(parent, "seo-command-center-server-test-"));
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const exited = once(server, "exit"); server.kill();
    await exited;
  }
  async function start() {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: process.cwd(), stdio: "ignore",
      env: { ...process.env, APP_BASE_URL: base, ORBIT_DATA_DIR: dataDirectory, SMTP_HOST: "", SMTP_FROM: "", WP_SITE_URL: "", WP_USERNAME: "", WP_APPLICATION_PASSWORD: "" },
    });
    for (let count = 0; count < 100; count++) {
      if (server.exitCode !== null) throw new Error("Isolated Next server exited before becoming ready.");
      try { if ((await fetch(`${base}/api/workspace`)).ok) return; } catch { /* Wait for startup. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error("Isolated Next server did not become ready.");
  }
  async function snapshot(): Promise<AppSnapshot> {
    const response = await fetch(`${base}/api/workspace`); assert.equal(response.status, 200); return response.json();
  }
  async function mutate(action: WorkspaceAction): Promise<AppSnapshot> {
    const response = await fetch(`${base}/api/workspace`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(action) });
    assert.equal(response.status, 200, `Workspace action failed: ${action.action}`); return response.json();
  }
  try {
    await start();
    assert.equal((await snapshot()).sites.length, 0);
    const added = await mutate({ action: "add-site", url: "https://example.com/", name: "Isolated smoke fixture" });
    const site = added.sites[0];
    await mutate({ action: "save-schedule", schedule: { websiteId: site.id, kind: "audit", enabled: false, cadence: "daily", timezone: "Asia/Kolkata", time: "09:00" } });
    const queued = await mutate({ action: "enqueue", websiteId: site.id, kind: "audit", maxPages: 1 });
    const jobId = queued.jobs[0].id;
    let current = queued;
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000)); current = await snapshot();
      if (["success", "failed"].includes(current.jobs.find(job => job.id === jobId)?.status ?? "")) break;
    }
    assert.equal(current.jobs.find(job => job.id === jobId)?.status, "success");
    assert.equal(current.crawls.length, 1);
    assert.ok(current.crawls[0].pages.some(page => page.status === 200 && !page.error), "A real public example.com HTML page was inspected");
    const backup = await (await fetch(`${base}/api/workspace?export=1`)).json() as AppSnapshot;
    await mutate({ action: "update-site", id: site.id, name: "Changed before restore" });
    const restored = await mutate({ action: "restore", backup, confirmed: true });
    assert.equal(restored.sites[0].name, "Isolated smoke fixture");
    assert.ok(restored.schedules.every(schedule => !schedule.enabled));
    const forbidden = await fetch(`${base}/api/workspace`, { method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(forbidden.status, 403);
    const badSpeed = await fetch(`${base}/api/pagespeed`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1", strategy: "mobile" }) });
    assert.equal(badSpeed.status, 400);
    await stop(); await start();
    const reopened = await snapshot();
    assert.equal(reopened.sites[0].id, site.id);
    assert.equal(reopened.crawls[0].id, restored.crawls[0].id);
    assert.equal(reopened.jobs.find(job => job.id === jobId)?.status, "success");
    assert.equal(reopened.jobs.length, 1, "Restart did not duplicate completed work");
    console.log("PASS: real production server, durable crawl job, backup/restore, restart persistence, and request guards. User workspace untouched.");
  } finally {
    await stop();
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Server verification failed"); process.exitCode = 1; });
