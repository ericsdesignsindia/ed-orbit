import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceError } from "./api-security";
import { createEmptyWorkspace, isFuturePlan, PLATFORMS, POST_STATUSES, POST_TYPES, validDate, type Client, type Channel, type Post, type SocialSnapshot } from "./social-workspace";

type Row = Record<string, unknown>;
const fail = (message: string, status = 400): never => { throw new WorkspaceError(message, status); };
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid record.");
  return value as Row;
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`Enter ${required ? "a non-empty" : "a valid"} text value (up to ${max} characters).`);
  return (value as string).trim();
}
function identifier(value: unknown): string {
  const id = text(value, 100, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail("Invalid record ID.");
  return id;
}
function bool(value: unknown): boolean { if (typeof value !== "boolean") fail("Invalid boolean value."); return value as boolean; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1e12) fail("Metrics must be non-negative whole numbers up to 1 trillion."); return value as number; }
function one<T extends string>(value: unknown, values: readonly T[]): T { if (!values.includes(value as T)) fail("Invalid option."); return value as T; }
function url(value: unknown): string {
  const result = text(value, 2048);
  if (!result) return result;
  try { const parsed = new URL(result); if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) fail("Enter an HTTP(S) link without credentials."); return parsed.href; } catch { return fail("Enter a full HTTP(S) link."); }
}
function date(value: unknown): string { if (!validDate(value)) fail("Choose a valid date from 2000 through 2100."); return value as string; }
function time(value: unknown): string { const result = text(value, 5, true); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) fail("Choose a valid local time."); return result; }
function channels(value: unknown): Channel[] {
  if (!Array.isArray(value) || value.length > PLATFORMS.length) fail("Select valid social channels.");
  const result = (value as unknown[]).map(item => { const c = row(item); return { platform: one(c.platform, PLATFORMS), handle: text(c.handle, 100), url: url(c.url) }; });
  if (new Set(result.map(c => c.platform)).size !== result.length) fail("Each platform can appear only once per client.");
  return result;
}
function clientFields(value: unknown) {
  const c = row(value), email = text(c.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid contact email.");
  return { name: text(c.name, 80, true), handle: text(c.handle, 100), email, channels: channels(c.channels) };
}
function postFields(value: unknown) {
  const p = row(value);
  return { clientId: identifier(p.clientId), title: text(p.title, 120, true), copy: text(p.copy, 5000, true), platform: one(p.platform, PLATFORMS), status: one(p.status, POST_STATUSES), date: date(p.date), time: time(p.time), type: one(p.type, POST_TYPES), assetUrl: url(p.assetUrl), publishedUrl: url(p.publishedUrl) };
}
function hex(value: unknown): string { const result = text(value, 7); if (!/^#[a-f\d]{6}$/i.test(result)) fail("Invalid client color."); return result; }
export function validateSocialSnapshot(value: unknown): SocialSnapshot {
  const s = row(value);
  if (s.version !== 1 || !Number.isSafeInteger(s.revision) || Number(s.revision) < 0 || typeof s.updatedAt !== "string" || !Number.isFinite(Date.parse(s.updatedAt))) fail("Unsupported or invalid Signal backup.");
  const array = (value: unknown, max: number) => { if (!Array.isArray(value) || value.length > max) fail("Workspace exceeds the record limit."); return value as unknown[]; };
  const clients: Client[] = array(s.clients, 500).map(value => { const c = row(value); return { ...clientFields(c), id: identifier(c.id), initials: text(c.initials, 3, true), color: hex(c.color), accent: hex(c.accent), archived: bool(c.archived), example: bool(c.example) }; });
  const posts: Post[] = array(s.posts, 10000).map(value => { const p = row(value); return { ...postFields(p), id: identifier(p.id), example: bool(p.example) }; });
  const notes = array(s.notes, 10000).map(value => { const n = row(value); const createdAt = text(n.createdAt, 50, true); if (!Number.isFinite(Date.parse(createdAt))) fail("Invalid note date."); return { id: identifier(n.id), clientId: identifier(n.clientId), text: text(n.text, 5000, true), resolved: bool(n.resolved), createdAt, example: bool(n.example) }; });
  const metrics = array(s.metrics, 50000).map(value => { const m = row(value); return { id: identifier(m.id), clientId: identifier(m.clientId), platform: one(m.platform, PLATFORMS), date: date(m.date), reach: number(m.reach), engagements: number(m.engagements), followers: number(m.followers), example: bool(m.example) }; });
  for (const items of [clients, posts, notes, metrics]) if (new Set(items.map(item => item.id)).size !== items.length) fail("Duplicate record IDs.");
  const ids = new Set(clients.map(c => c.id));
  if ([...posts, ...notes, ...metrics].some(item => !ids.has(item.clientId))) fail("A record references a missing client.");
  if (new Set(clients.map(c => c.name.toLowerCase())).size !== clients.length) fail("Client names must be unique.");
  if (posts.some(p => !clients.find(c => c.id === p.clientId)?.channels.some(c => c.platform === p.platform) || (p.status === "Published" && !p.publishedUrl))) fail("Posts require a matching client channel and a link when marked published.");
  if (new Set(metrics.map(m => `${m.clientId}|${m.platform}|${m.date}`)).size !== metrics.length) fail("Duplicate daily metric records.");
  return { version: 1, revision: Number(s.revision), updatedAt: text(s.updatedAt, 50, true), agencyName: text(s.agencyName, 80, true), clients, posts, notes, metrics };
}

export function createSocialStore(path = ":memory:", now: () => Date = () => new Date()) {
  const fresh = path === ":memory:" || !existsSync(path);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    if (Object.values(db.prepare("PRAGMA quick_check").get() ?? {})[0] !== "ok") fail("Signal database needs recovery; the original file is preserved.", 500);
    if (fresh) {
      db.exec("BEGIN IMMEDIATE; CREATE TABLE signal (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE recovery (id INTEGER PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=1;");
      db.prepare("INSERT INTO signal VALUES (1, ?)").run(JSON.stringify(createEmptyWorkspace(now())));
      db.exec("COMMIT");
    } else if (db.prepare("PRAGMA user_version").get()?.user_version !== 1 || !db.prepare("SELECT id FROM signal WHERE id=1").get()) fail("Unsupported Signal database. Existing data is preserved.", 500);
  } catch (error) { db.close(); throw error; }
  const getSnapshot = () => validateSocialSnapshot(JSON.parse(String(db.prepare("SELECT body FROM signal WHERE id=1").get()!.body)));
  try { getSnapshot(); } catch (error) { db.close(); throw error; }
  function replaceSnapshot(value: unknown): void {
    const validated = validateSocialSnapshot(value);
    db.exec("BEGIN IMMEDIATE");
    try { db.prepare("UPDATE signal SET body=? WHERE id=1").run(JSON.stringify(validated)); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function dispatch(input: unknown): SocialSnapshot {
    const a = row(input);
    db.exec("BEGIN IMMEDIATE");
    try {
      const s = getSnapshot();
      const requireClient = (id: string) => { const client = s.clients.find(c => c.id === id); if (!client || client.archived) return fail("Select an active client."); return client; };
      const requirePost = (id: string) => { const post = s.posts.find(p => p.id === id); if (!post) return fail("Post not found.", 404); requireClient(post.clientId); return post; };
      switch (a.action) {
        case "save-client": {
          const fields = clientFields(a.client), data = row(a.client), id = data.id === undefined ? randomUUID() : identifier(data.id), old = s.clients.find(c => c.id === id);
          if (data.id !== undefined && !old) fail("Client not found.", 404);
          if (s.clients.some(c => c.id !== id && c.name.toLowerCase() === fields.name.toLowerCase())) fail("This client name already exists.");
          if (!old && s.clients.length >= 500) fail("The workspace supports up to 500 clients.");
          if (s.posts.some(p => p.clientId === id && !fields.channels.some(c => c.platform === p.platform))) fail("Keep channels that have posts; move or delete those posts first.");
          const initials = fields.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
          const client: Client = { id, initials, color: old?.color ?? "#c6d7f2", accent: old?.accent ?? "#29415f", archived: old?.archived ?? false, example: old?.example ?? false, ...fields };
          s.clients = [...s.clients.filter(c => c.id !== id), client]; break;
        }
        case "archive-client": { const id = identifier(a.id), c = s.clients.find(c => c.id === id); if (!c) fail("Client not found.", 404); c!.archived = bool(a.archived); break; }
        case "save-post": {
          const p = row(a.post), fields = postFields(p), client = requireClient(fields.clientId);
          if (!client.channels.some(c => c.platform === fields.platform)) fail("Add this platform to the client's channels first.");
          if (fields.status === "Scheduled" && !isFuturePlan(fields.date, fields.time, now())) fail("A scheduled post needs a future date and time (IST).");
          if (fields.status === "Published" && !fields.publishedUrl) fail("Add the live post link before marking it published.");
          const id = p.id === undefined ? randomUUID() : identifier(p.id), old = s.posts.find(p => p.id === id);
          if (p.id !== undefined && !old) fail("Post not found.", 404);
          if (old?.status === "Publishing") fail("This post is being sent to Meta and cannot be changed yet.", 409);
          if (!old && s.posts.length >= 10000) fail("Post limit reached.");
          if (old?.clientId !== undefined && old.clientId !== fields.clientId) fail("Create a new post to move content to another client.");
          s.posts = [{ ...fields, id, example: old?.example ?? client.example }, ...s.posts.filter(p => p.id !== id)]; break;
        }
        case "set-status": {
          const p = requirePost(identifier(a.id)), status = one(a.status, POST_STATUSES);
          if (p.status === "Publishing" && status !== "Published" && status !== "Scheduled") fail("This post is being sent to Meta and cannot change state yet.", 409);
          if (status === "Scheduled" && !isFuturePlan(p.date, p.time, now())) fail("Update the post's date and time before scheduling it (IST).");
          if (status === "Published") { const link = url(a.publishedUrl ?? p.publishedUrl); if (!link) fail("Add the live post link before marking it published."); p.publishedUrl = link; }
          p.status = status; break;
        }
        case "delete-post": { const p = requirePost(identifier(a.id)); if (p.status === "Publishing") fail("This post is being sent to Meta and cannot be deleted yet.", 409); s.posts = s.posts.filter(item => item.id !== p.id); break; }
        case "add-note": { const client = requireClient(identifier(a.clientId)); if (s.notes.length >= 10000) fail("Note limit reached."); s.notes.unshift({ id: randomUUID(), clientId: client.id, text: text(a.text, 5000, true), resolved: false, createdAt: now().toISOString(), example: client.example }); break; }
        case "resolve-note": { const note = s.notes.find(n => n.id === identifier(a.id)); if (!note) fail("Note not found.", 404); note!.resolved = bool(a.resolved); break; }
        case "save-metric": { const m = row(a.metric), client = requireClient(identifier(m.clientId)), platform = one(m.platform, PLATFORMS), day = date(m.date); if (!client.channels.some(c => c.platform === platform)) fail("Add this platform to the client first."); const old = s.metrics.find(m => m.clientId === client.id && m.platform === platform && m.date === day); if (!old && s.metrics.length >= 50000) fail("Metric record limit reached."); s.metrics = [...s.metrics.filter(m => m.id !== old?.id), { id: old?.id ?? randomUUID(), clientId: client.id, platform, date: day, reach: number(m.reach), engagements: number(m.engagements), followers: number(m.followers), example: old?.example ?? client.example }]; break; }
        case "save-metrics": {
          if (!Array.isArray(a.metrics) || a.metrics.length > 200) fail("Choose up to 200 daily metric rows to save.");
          for (const value of a.metrics as unknown[]) {
            const m = row(value), client = requireClient(identifier(m.clientId)), platform = one(m.platform, PLATFORMS), day = date(m.date);
            if (!client.channels.some(c => c.platform === platform)) fail("Add each synced platform to the client first.");
            const old = s.metrics.find(item => item.clientId === client.id && item.platform === platform && item.date === day);
            if (!old && s.metrics.length >= 50000) fail("Metric record limit reached.");
            s.metrics = [...s.metrics.filter(item => item.id !== old?.id), { id: old?.id ?? randomUUID(), clientId: client.id, platform, date: day, reach: number(m.reach), engagements: number(m.engagements), followers: number(m.followers), example: old?.example ?? client.example }];
          }
          break;
        }
        case "settings": s.agencyName = text(a.agencyName, 80, true); break;
        case "remove-examples": { const ids = new Set(s.clients.filter(c => c.example).map(c => c.id)); s.clients = s.clients.filter(c => !c.example); s.posts = s.posts.filter(p => !p.example && !ids.has(p.clientId)); s.notes = s.notes.filter(n => !n.example && !ids.has(n.clientId)); s.metrics = s.metrics.filter(m => !m.example && !ids.has(m.clientId)); break; }
        case "restore": { const backup = validateSocialSnapshot(a.backup); db.prepare("INSERT INTO recovery(body) VALUES (?)").run(JSON.stringify(s)); Object.assign(s, backup, { revision: s.revision }); break; }
        default: fail("Unknown Signal action.");
      }
      s.revision++; s.updatedAt = now().toISOString();
      const validated = validateSocialSnapshot(s);
      db.prepare("UPDATE signal SET body=? WHERE id=1").run(JSON.stringify(validated));
      db.exec("COMMIT"); return validated;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (getSnapshot().clients.some(client => client.example) || getSnapshot().posts.some(post => post.example) || getSnapshot().notes.some(note => note.example) || getSnapshot().metrics.some(metric => metric.example)) dispatch({ action: "remove-examples" });
  return { getSnapshot, replaceSnapshot, dispatch, close: () => db.close() };
}
type SocialStore = ReturnType<typeof createSocialStore>;
const globalStore = globalThis as typeof globalThis & { signalStore?: SocialStore };
export function getSocialStore(): SocialStore {
  const path = join(process.env.ORBIT_DATA_DIR || join(process.cwd(), ".data"), "signal.sqlite");
  return globalStore.signalStore ??= createSocialStore(path);
}
