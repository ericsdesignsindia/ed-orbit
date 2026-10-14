import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSocialStore } from "./social-store";

function temporaryStore() {
  const folder = mkdtempSync(join(tmpdir(), "signal-test-"));
  const path = join(folder, "signal.sqlite");
  return { folder, path };
}
function createClient(store: ReturnType<typeof createSocialStore>) {
  return store.dispatch({ action: "save-client", client: { name: "Test Client", handle: "@test", email: "", channels: [{ platform: "Instagram", handle: "@test", url: "https://instagram.com/test" }] } }).clients[0];
}

test("Signal persists client and post planning records across reopen", () => {
  const { folder, path } = temporaryStore();
  const now = () => new Date("2026-10-12T12:00:00.000Z");
  try {
    const store = createSocialStore(path, now);
    const initial = store.getSnapshot();
    assert.equal(initial.clients.length, 0);
    const client = store.dispatch({ action: "save-client", client: { name: "Real Client", handle: "@realclient", email: "hello@example.com", channels: [{ platform: "Instagram", handle: "@realclient", url: "https://instagram.com/realclient" }] } }).clients.find(item => item.name === "Real Client");
    assert.ok(client);
    const created = store.dispatch({ action: "save-post", post: { clientId: client.id, title: "Launch day", copy: "A caption for the real client.", platform: "Instagram", status: "Draft", date: "2026-10-14", time: "10:00", type: "Static", assetUrl: "", publishedUrl: "" } });
    assert.ok(created.posts.some(post => post.title === "Launch day"));
    store.close();

    const reopened = createSocialStore(path, now);
    const saved = reopened.getSnapshot();
    assert.ok(saved.clients.some(item => item.name === "Real Client"));
    assert.ok(saved.posts.some(item => item.title === "Launch day"));
    reopened.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("Signal enforces channel ownership and publishing boundaries", () => {
  const store = createSocialStore(":memory:", () => new Date("2026-10-12T12:00:00.000Z"));
  try {
    const client = createClient(store)!;
    assert.throws(() => store.dispatch({ action: "save-post", post: { clientId: client.id, title: "Wrong channel", copy: "No matching channel.", platform: "LinkedIn", status: "Draft", date: "2026-10-14", time: "10:00", type: "Static", assetUrl: "", publishedUrl: "" } }), /platform/i);
    assert.throws(() => store.dispatch({ action: "save-post", post: { clientId: client.id, title: "Published without link", copy: "A live post needs a receipt.", platform: "Instagram", status: "Published", date: "2026-10-14", time: "10:00", type: "Static", assetUrl: "", publishedUrl: "" } }), /live post link/i);
  } finally { store.close(); }
});

test("Signal rejects a scheduled item in the past using Asia/Kolkata time", () => {
  const store = createSocialStore(":memory:", () => new Date("2026-10-12T12:00:00.000Z"));
  try {
    const client = createClient(store)!;
    assert.throws(() => store.dispatch({ action: "save-post", post: { clientId: client.id, title: "Past plan", copy: "This should stay a draft.", platform: "Instagram", status: "Scheduled", date: "2026-10-12", time: "10:00", type: "Static", assetUrl: "", publishedUrl: "" } }), /future date/i);
  } finally { store.close(); }
});
