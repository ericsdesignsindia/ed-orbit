import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createWordPressService } from "./wordpress";

const config = { siteUrl: "https://example.com", username: "editor", password: "fake-test-password" };
function fixture() {
  const db = new DatabaseSync(":memory:");
  let current = { title: { raw: "Old title" }, excerpt: { raw: "Old excerpt" }, modified_gmt: "2026-01-01T00:00:00", status: "draft" };
  let writes = 0; let reads = 0; let loseResponse = false; let noCommit = false;
  const transport = async (_config: unknown, path: string, body?: { title: string; excerpt?: string }) => {
    assert.match(path, /^\/wp-json\/wp\/v2\/(posts|pages)\/42\?context=edit$/);
    if (!body) { reads++; return structuredClone(current); }
    writes++; assert.deepEqual(Object.keys(body).sort(), ["excerpt", "title"]);
    assert.equal(typeof body.excerpt, "string");
    if (!noCommit) current = { ...current, title: { raw: body.title }, excerpt: { raw: body.excerpt! }, modified_gmt: `2026-01-01T00:00:0${writes}` };
    if (loseResponse) throw new Error("socket closed after possible commit");
    return structuredClone(current);
  };
  const service = createWordPressService(db, config, transport);
  const preview = () => service.run({ action: "preview", siteUrl: config.siteUrl, postId: 42, type: "posts", title: "New title", excerpt: "New excerpt" });
  return { db, service, preview, transport, get writes() { return writes; }, get reads() { return reads; }, change() { current.modified_gmt = "newer"; }, lose(commit = true) { loseResponse = true; noCommit = !commit; } };
}
test("WordPress requires approval, preserves status, verifies and rolls back exact fields", async () => {
  const f = fixture(); const r = await f.preview();
  await assert.rejects(f.service.run({ action: "apply", changeId: r.id }), /approval/);
  assert.equal(f.writes, 0);
  const applied = await f.service.run({ action: "apply", changeId: r.id, confirmed: true });
  assert.equal(applied.state, "applied"); assert.equal(applied.applied?.status, "draft");
  assert.equal(f.reads, 3); assert.equal(f.writes, 1);
  await assert.rejects(f.service.run({ action: "apply", changeId: r.id, confirmed: true }), /cannot be submitted/);
  const rollback = await f.service.run({ action: "rollback", changeId: r.id, confirmed: true });
  assert.equal(rollback.state, "rolledback"); assert.equal(f.writes, 2);
  await assert.rejects(f.service.run({ action: "rollback", changeId: r.id, confirmed: true }), /cannot be submitted/);
  f.db.close();
});
test("WordPress rejects wrong origin, credentials, paths and field/ID boundaries before transport", async () => {
  const f = fixture();
  const base = { action: "preview", siteUrl: config.siteUrl, postId: 42, type: "posts", title: "x", excerpt: "" };
  for (const patch of [{ siteUrl: "https://evil.example" }, { siteUrl: "https://user:pass@example.com" }, { siteUrl: "https://example.com/path" }, { siteUrl: "http://example.com" }, { siteUrl: "https://127.0.0.1" }, { postId: 0 }, { postId: 1.1 }, { postId: "42" }, { type: "users" }, { title: "x".repeat(201) }, { excerpt: "x".repeat(5001) }]) await assert.rejects(f.service.run({ ...base, ...patch }));
  assert.equal(f.reads, 0); assert.equal(f.writes, 0); f.db.close();
});
test("optimistic conflict prevents apply and rollback writes", async () => {
  const f = fixture(); const r = await f.preview(); f.change();
  await assert.rejects(f.service.run({ action: "apply", changeId: r.id, confirmed: true }), /changed since/); assert.equal(f.writes, 0);
  const fresh = await f.preview(); await f.service.run({ action: "apply", changeId: fresh.id, confirmed: true }); f.change();
  await assert.rejects(f.service.run({ action: "rollback", changeId: fresh.id, confirmed: true }), /changed since/); assert.equal(f.writes, 1); f.db.close();
});
test("ambiguous apply is never resent, survives service restart and reconciles read-only", async () => {
  const f = fixture(); const r = await f.preview(); f.lose();
  assert.equal((await f.service.run({ action: "apply", changeId: r.id, confirmed: true })).state, "uncertain");
  await assert.rejects(f.preview(), /uncertain write/);
  const restarted = createWordPressService(f.db, config, f.transport);
  assert.equal(f.writes, 1);
  await assert.rejects(restarted.run({ action: "apply", changeId: r.id, confirmed: true }), /cannot be submitted/);
  assert.equal((await restarted.run({ action: "reconcile", changeId: r.id })).state, "applied"); assert.equal(f.writes, 1); f.db.close();
});
test("uncertain uncommitted write requires a new preview", async () => {
  const f = fixture(); const r = await f.preview(); f.lose(false);
  await f.service.run({ action: "apply", changeId: r.id, confirmed: true });
  assert.equal((await f.service.run({ action: "reconcile", changeId: r.id })).state, "failed");
  await assert.rejects(f.service.run({ action: "apply", changeId: r.id, confirmed: true })); assert.equal(f.writes, 1); f.db.close();
});
test("concurrent approvals serialize and submit only once", async () => {
  const f = fixture(); const r = await f.preview();
  const results = await Promise.allSettled([1, 2].map(() => f.service.run({ action: "apply", changeId: r.id, confirmed: true })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.writes, 1); f.db.close();
});
test("ambiguous rollback can reconcile without replay", async () => {
  const f = fixture(); const r = await f.preview(); await f.service.run({ action: "apply", changeId: r.id, confirmed: true }); f.lose();
  assert.equal((await f.service.run({ action: "rollback", changeId: r.id, confirmed: true })).state, "uncertain");
  await assert.rejects(f.service.run({ action: "rollback", changeId: r.id, confirmed: true }));
  assert.equal((await f.service.run({ action: "reconcile", changeId: r.id })).state, "rolledback"); assert.equal(f.writes, 2); f.db.close();
});

test("standard WordPress pages without excerpts support title-only updates and rollback", async () => {
  const db = new DatabaseSync(":memory:");
  let current = { title: { raw: "Page title" }, modified_gmt: "2026-01-01T00:00:00", status: "publish" };
  let writes = 0;
  const service = createWordPressService(db, config, async (_config, _path, body) => {
    if (body) {
      assert.deepEqual(Object.keys(body), ["title"]);
      writes++;
      current = { ...current, title: { raw: body.title }, modified_gmt: `2026-01-01T00:00:0${writes}` };
    }
    return structuredClone(current);
  });
  try {
    await assert.rejects(service.run({ action: "preview", siteUrl: config.siteUrl, postId: 42, type: "pages", title: "New", excerpt: "Unsupported" }), /does not expose/);
    const preview = await service.run({ action: "preview", siteUrl: config.siteUrl, postId: 42, type: "pages", title: "New page title", excerpt: "" });
    assert.equal((await service.run({ action: "apply", changeId: preview.id, confirmed: true })).state, "applied");
    assert.equal((await service.run({ action: "rollback", changeId: preview.id, confirmed: true })).state, "rolledback");
    assert.equal(current.title.raw, "Page title");
    assert.equal(current.status, "publish");
  } finally { db.close(); }
});
