import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceError } from "./api-security";
import { buildPageSchema, changeLocalWorkspace, emptyLocalWorkspace, recordPublicActivity } from "./local-workspace";

function setup() {
  let sequence = 0;
  const nextId = () => `record-${++sequence}`;
  let workspace = emptyLocalWorkspace(new Date("2026-10-13T00:00:00.000Z"));
  workspace = changeLocalWorkspace(workspace, { action: "business", business: { ...workspace.business, name: "Test Plumbing", category: "Plumber", description: "Local plumbing help.", phone: "+1 555 123 4567" } }, new Date("2026-10-13T00:01:00.000Z"), nextId);
  workspace = changeLocalWorkspace(workspace, { action: "service", service: { name: "Drain cleaning", description: "Fast drain cleaning." } }, new Date("2026-10-13T00:02:00.000Z"), nextId);
  workspace = changeLocalWorkspace(workspace, { action: "location", location: { city: "Austin", region: "TX", address: "1 Main St", postalCode: "78701", country: "US", details: "Same day appointments." } }, new Date("2026-10-13T00:03:00.000Z"), nextId);
  workspace = changeLocalWorkspace(workspace, { action: "generate", serviceIds: [workspace.services[0].id], locationIds: [workspace.locations[0].id] }, new Date("2026-10-13T00:04:00.000Z"), nextId);
  return { workspace, nextId };
}

test("LocalPilot starts empty and generates unique service/location pages", () => {
  const { workspace } = setup();
  assert.equal(workspace.pages.length, 1);
  assert.equal(workspace.pages[0].status, "Draft");
  assert.match(workspace.pages[0].slug, /drain-cleaning-austin-tx/);
  assert.throws(() => changeLocalWorkspace(workspace, { action: "generate", serviceIds: [workspace.services[0].id], locationIds: [workspace.locations[0].id] }), (error: unknown) => error instanceof WorkspaceError && error.message.includes("already exist"));
});

test("published pages accept idempotent tracked views and public enquiries", () => {
  const { workspace, nextId } = setup();
  const draft = workspace.pages[0];
  const live = changeLocalWorkspace(workspace, { action: "page", id: draft.id, title: draft.title, intro: draft.intro, body: draft.body, status: "Live" }, new Date("2026-10-13T00:05:00.000Z"), nextId);
  const viewed = recordPublicActivity(live, { pageId: draft.id, kind: "view", eventId: "view-1" }, new Date("2026-10-13T00:06:00.000Z"), nextId);
  const viewedAgain = recordPublicActivity(viewed, { pageId: draft.id, kind: "view", eventId: "view-1" }, new Date("2026-10-13T00:07:00.000Z"), nextId);
  assert.equal(viewedAgain.pages[0].visits, 1);
  const withLead = recordPublicActivity(viewedAgain, { pageId: draft.id, kind: "form", eventId: "form-1", website: "", lead: { pageId: draft.id, name: "Local Contact", phone: "+1 555 000 0000", email: "contact@example.com", channel: "Form", status: "New", notes: "Please call.", value: null } }, new Date("2026-10-13T00:08:00.000Z"), nextId);
  assert.equal(withLead.leads.length, 1);
  assert.equal(withLead.pages[0].formSubmissions, 1);
  const schema = buildPageSchema(withLead, withLead.pages[0], "https://example.test");
  assert.equal(schema["@context"], "https://schema.org");
  assert.equal((schema["@graph"] as unknown[]).length, 3);
});
