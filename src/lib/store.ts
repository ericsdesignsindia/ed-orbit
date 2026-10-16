import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppSnapshot, JobRecord, ScheduleRecord, WorkspaceAction } from "./contracts";
import { normalizeWebsiteUrl } from "./site-url";
import { parseLiveWorkspace } from "./live-workspace";
import { nextScheduleRun, validTimezone } from "./scheduler";
import { WorkspaceError } from "./api-security";

type Check = (v: unknown) => boolean;
const str = (max = 4096): Check => v => typeof v === "string" && v.length <= max;
const num = (min = 0, max = Number.MAX_SAFE_INTEGER): Check => v => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const integer = (min: number, max: number): Check => v => num(min, max)(v) && Number.isInteger(v);
const bool: Check = v => typeof v === "boolean";
const one = (...values: unknown[]): Check => v => values.includes(v);
const optional = (check: Check): Check => v => v === undefined || check(v);
const array = (check: Check, max = 100000): Check => v => Array.isArray(v) && v.length <= max && v.every(check);
const object = (shape: Record<string, Check>): Check => v => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every(k => Object.hasOwn(shape, k)) && Object.entries(shape).every(([k, check]) => check((v as Record<string, unknown>)[k]));
const id: Check = v => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const date: Check = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(v) && Number.isFinite(Date.parse(v));
const url: Check = v => { try { return typeof v === "string" && normalizeWebsiteUrl(v) === v; } catch { return false; } };
const binding = object({ siteUrl: v => v === "" || (typeof v === "string" && v.length <= 2048 && (/^sc-domain:[a-z\d.-]+$/i.test(v) || url(v))), propertyId: v => v === "" || (typeof v === "string" && /^\d{1,30}$/.test(v)) });
function bindingMatches(site: AppSnapshot["sites"][number]): boolean {
  const bound = site.bindings.siteUrl;
  if (!bound) return true;
  if (bound.startsWith("sc-domain:")) { const domain = bound.slice(10).toLowerCase(); return site.domain === domain || site.domain.endsWith(`.${domain}`); }
  return site.url.startsWith(bound);
}
const kind = one("audit", "report", "traffic-alert");
const options = { maxPages: integer(1, 100), days: one(7, 30, 90), dropPercent: num(1, 100), minClicks: num(), notificationEmail: optional(v => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) };
const metrics = { clicks: num(), impressions: num(), ctr: num(), position: num() };
const changePercent: Check = v => v === null || num(-100, 1e12)(v);
const insight = object({ key: str(4096), ...metrics, previousClicks: num(), clickChangePercent: changePercent, currentObserved: optional(bool), previousObserved: optional(bool) });
export const isGoogleReport = object({
  startDate: date, endDate: date,
  properties: optional(object({ siteUrl: optional(str(2048)), propertyId: optional(str(40)) })),
  gsc: optional(object({ ...metrics, rows: array(object({ date, clicks: num(), impressions: num() }), 25000) })),
  ga4: optional(object({ users: num(), sessions: num(), pageViews: num(), trafficScope: optional(one("organic-search")), keyEvents: optional(num()) })),
  queries: optional(array(insight, 2000)), pages: optional(array(insight, 2000)),
  opportunities: optional(array(object({ id: str(5000), type: one("low-ctr", "content-decay"), title: str(5000), detail: str(10000), url: optional(str(4096)) }), 100)),
  limitations: optional(array(str(10000), 100)), errors: optional(array(str(2000), 20)), retryable: optional(bool), reconnectNeeded: optional(bool),
  comparison: optional(object({ previous: object(metrics), changes: object({ clicksPercent: changePercent, impressionsPercent: changePercent }), startDate: date, endDate: date })),
});
const issue = object({ id: str(200), code: str(200), title: str(1000), severity: one("critical", "warning", "info"), url: str(), detail: str(20000), recommendation: str(10000), change: optional(one("new", "ongoing", "resolved", "not-rechecked")) });
const crawlPage = object({ url: str(), finalUrl: str(), status: integer(0, 599), title: str(20000), description: str(20000), canonical: str(), h1Count: integer(0, 100000), noindex: bool, internalLinks: array(str(), 10000), redirectCount: integer(0, 100), error: optional(str(2000)) });
const crawl = object({ id, websiteId: id, siteUrl: url, startedAt: date, completedAt: date, score: num(0, 100), pages: array(crawlPage, 10000), issues: array(issue, 20000), limitations: array(str(10000), 1000), requests: integer(0, 100000), source: optional(one("native", "screaming-frog")) });
const crawlImport = object({ source: one("screaming-frog"), startedAt: date, completedAt: date, score: num(0, 100), pages: array(crawlPage, 10000), issues: array(issue, 20000), limitations: array(str(10000), 1000), requests: integer(1, 10000) });
const report = object({ id, websiteId: id, fetchedAt: date, days: one(7, 30, 90), data: isGoogleReport });
const job = object({ id, websiteId: id, kind, status: one("queued", "running", "success", "failed"), createdAt: date, startedAt: optional(date), completedAt: optional(date), attempt: integer(0, 3), summary: str(4000), error: optional(str(2000)), resultId: optional(id), scheduleId: optional(id), ...options });
const schedule = object({ id, websiteId: id, kind, enabled: bool, cadence: one("daily", "weekly"), time: v => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v), timezone: v => typeof v === "string" && validTimezone(v), weekday: integer(0, 6), nextRunAt: date, lastRunAt: optional(date), ...options });
const snapshotShape = object({ version: one(2), revision: integer(0, Number.MAX_SAFE_INTEGER), sites: array(object({ id, name: v => str(100)(v) && !!(v as string).trim(), url, domain: str(253), archived: bool, createdAt: date, bindings: binding }), 500), crawls: array(crawl, 15000), reports: array(report, 15000), jobs: array(job, 25000), schedules: array(schedule, 1500), notifications: array(object({ id, websiteId: id, createdAt: date, title: str(500), message: str(4000), read: bool, emailStatus: optional(one("sent", "failed", "not-configured")), jobId: optional(id) }), 25000), runner: object({ active: bool, lastTickAt: optional(date), localOnly: one(true) }), migrationComplete: bool });
export function validateSnapshot(value: unknown): asserts value is AppSnapshot {
  if (!snapshotShape(value)) throw new WorkspaceError("Invalid workspace backup. Original data has been preserved.");
  const s = value as AppSnapshot;
  const ids = new Set(s.sites.map(x => x.id));
  if (ids.size !== s.sites.length || new Set(s.sites.map(x => x.url)).size !== s.sites.length || s.sites.some(x => new URL(x.url).hostname !== x.domain || !bindingMatches(x))) throw new WorkspaceError("Invalid or duplicate websites, or Google binding does not match its website.");
  for (const rows of [s.crawls, s.reports, s.jobs, s.schedules, s.notifications]) if (new Set(rows.map(x => x.id)).size !== rows.length || rows.some(x => !ids.has(x.websiteId))) throw new WorkspaceError("Invalid workspace references.");
  if (s.crawls.some(c => c.siteUrl !== s.sites.find(x => x.id === c.websiteId)?.url)) throw new WorkspaceError("Crawl website does not match.");
}
const empty = (): AppSnapshot => ({ version: 2, revision: 0, sites: [], crawls: [], reports: [], jobs: [], schedules: [], notifications: [], runner: { active: false, localOnly: true }, migrationComplete: false });
export type JobInput = Pick<JobRecord, "websiteId" | "kind"> & Partial<Pick<JobRecord, "maxPages" | "days" | "dropPercent" | "minClicks" | "notificationEmail" | "scheduleId">>;
function defaults(input: JobInput) { return { maxPages: input.maxPages ?? 25, days: input.days ?? 30, dropPercent: input.dropPercent ?? 30, minClicks: input.minClicks ?? 100, ...(input.notificationEmail ? { notificationEmail: input.notificationEmail } : {}) }; }
function requireSite(s: AppSnapshot, websiteId: string, active = true) { const site = s.sites.find(x => x.id === websiteId); if (!site || (active && site.archived)) throw new WorkspaceError("Select an active website."); return site; }
function appendJob(s: AppSnapshot, input: JobInput, now: string): JobRecord {
  requireSite(s, input.websiteId);
  const record: JobRecord = { id: randomUUID(), websiteId: input.websiteId, kind: input.kind, ...defaults(input), ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}), status: "queued", createdAt: now, attempt: 0, summary: "Waiting for the local server runner." };
  if (!job(record)) throw new WorkspaceError("Invalid job settings.");
  if (s.jobs.some(x => x.websiteId === record.websiteId && x.kind === record.kind && ["queued", "running"].includes(x.status))) throw new WorkspaceError("This website already has that job queued or running.", 409);
  s.jobs.unshift(record); return record;
}
function retain(s: AppSnapshot) {
  const keep = <T extends { websiteId: string }>(rows: T[], limit: number): T[] => { const counts = new Map<string, number>(); return rows.filter(x => { const n = (counts.get(x.websiteId) ?? 0) + 1; counts.set(x.websiteId, n); return n <= limit; }); };
  s.crawls = keep(s.crawls, 30); s.reports = keep(s.reports, 30); s.notifications = keep(s.notifications, 50);
  s.jobs = [...s.jobs.filter(x => ["queued", "running"].includes(x.status)), ...keep(s.jobs.filter(x => !["queued", "running"].includes(x.status)), 45)];
}

export function createStore(path = ":memory:") {
  const fresh = path === ":memory:" || !existsSync(path);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    const integrity = db.prepare("PRAGMA quick_check").get();
    if (!integrity || Object.values(integrity)[0] !== "ok") throw new Error("Workspace database is damaged; restore from a backup without deleting this file.");
    if (fresh) {
      db.exec("BEGIN IMMEDIATE; CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE recovery_snapshots (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL); PRAGMA user_version=2;");
      db.prepare("INSERT INTO workspace VALUES (1, ?)").run(JSON.stringify(empty()));
      db.exec("COMMIT");
    } else if (db.prepare("PRAGMA user_version").get()?.user_version !== 2 || !db.prepare("SELECT id FROM workspace WHERE id=1").get()) {
      throw new Error("Workspace database has an unsupported schema or missing snapshot; original file has been preserved.");
    }
  } catch (error) { db.close(); throw error; }
  const getSnapshot = (): AppSnapshot => { const row = db.prepare("SELECT body FROM workspace WHERE id=1").get()!; const result: unknown = JSON.parse(String(row.body)); validateSnapshot(result); return result; };
  try { getSnapshot(); } catch (error) { db.close(); throw error; }
  const mutate = <T>(fn: (s: AppSnapshot) => T, backup = false): T => {
    db.exec("BEGIN IMMEDIATE");
    try { const s = getSnapshot(); if (backup) db.prepare("INSERT INTO recovery_snapshots(created_at,body) VALUES (?,?)").run(new Date().toISOString(), JSON.stringify(s)); const result = fn(s); retain(s); s.revision++; validateSnapshot(s); db.prepare("UPDATE workspace SET body=? WHERE id=1").run(JSON.stringify(s)); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const enqueueJob = (input: JobInput): JobRecord => mutate(s => appendJob(s, input, new Date().toISOString()));
  function dispatch(input: unknown): AppSnapshot {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkspaceError("Invalid workspace action.");
    const a = input as WorkspaceAction;
    const shapes: Record<string, Check> = {
      "add-site": object({ action: one("add-site"), url: str(2048), name: optional(str(100)) }),
      "update-site": object({ action: one("update-site"), id, name: optional(v => str(100)(v) && !!(v as string).trim()), archived: optional(bool), bindings: optional(binding) }),
      "delete-site": object({ action: one("delete-site"), id, confirmed: one(true) }),
      "enqueue": object({ action: one("enqueue"), websiteId: id, kind, maxPages: optional(options.maxPages), days: optional(options.days), dropPercent: optional(options.dropPercent), minClicks: optional(options.minClicks) }),
      "save-schedule": object({ action: one("save-schedule"), schedule: object({ id: optional(id), websiteId: id, kind, enabled: optional(bool), cadence: optional(one("daily", "weekly")), time: optional(str(5)), timezone: optional(str(100)), weekday: optional(integer(0, 6)), maxPages: optional(options.maxPages), days: optional(options.days), dropPercent: optional(options.dropPercent), minClicks: optional(options.minClicks), notificationEmail: options.notificationEmail }) }),
      "delete-schedule": object({ action: one("delete-schedule"), id }), "read-notifications": object({ action: one("read-notifications") }),
      "save-report": object({ action: one("save-report"), websiteId: id, days: one(7, 30, 90), data: isGoogleReport }),
      "import-screaming-frog": object({ action: one("import-screaming-frog"), websiteId: id, crawl: crawlImport }),
      "import-legacy": object({ action: one("import-legacy"), raw: str(6 * 1024 * 1024) }), "restore": object({ action: one("restore"), backup: () => true, confirmed: one(true) }),
    };
    if (!Object.hasOwn(shapes, a.action) || !shapes[a.action](a)) throw new WorkspaceError("Invalid workspace action or fields.");
    if (a.action === "restore") validateSnapshot(a.backup);
    mutate(s => {
      const now = new Date().toISOString();
      switch (a.action) {
        case "add-site": { if (s.sites.length >= 500) throw new WorkspaceError("A workspace supports up to 500 websites."); let normalized: string; try { normalized = normalizeWebsiteUrl(a.url); } catch { throw new WorkspaceError("Enter a valid public website URL."); } if (s.sites.some(x => x.url === normalized)) throw new WorkspaceError("This website has already been added."); s.sites.push({ id: randomUUID(), name: a.name?.trim() || new URL(normalized).hostname, url: normalized, domain: new URL(normalized).hostname, archived: false, createdAt: now, bindings: { siteUrl: "", propertyId: "" } }); break; }
        case "update-site": { const site = requireSite(s, a.id, false); if (a.name !== undefined) site.name = a.name.trim(); if (a.bindings) site.bindings = a.bindings; if (a.archived !== undefined) { if (a.archived && s.jobs.some(x => x.websiteId === site.id && ["queued", "running"].includes(x.status))) throw new WorkspaceError("Wait for this website's pending jobs before archiving.", 409); site.archived = a.archived; if (a.archived) s.schedules.filter(x => x.websiteId === site.id).forEach(x => { x.enabled = false; }); } break; }
        case "delete-site": { requireSite(s, a.id, false); if (s.jobs.some(x => x.websiteId === a.id && ["queued", "running"].includes(x.status))) throw new WorkspaceError("Wait for this website's pending jobs before deleting.", 409); s.sites = s.sites.filter(x => x.id !== a.id); s.crawls = s.crawls.filter(x => x.websiteId !== a.id); s.reports = s.reports.filter(x => x.websiteId !== a.id); s.jobs = s.jobs.filter(x => x.websiteId !== a.id); s.schedules = s.schedules.filter(x => x.websiteId !== a.id); s.notifications = s.notifications.filter(x => x.websiteId !== a.id); break; }
        case "enqueue": appendJob(s, a, now); break;
        case "save-schedule": { requireSite(s, a.schedule.websiteId); const old = a.schedule.id ? s.schedules.find(x => x.id === a.schedule.id) : undefined; if (a.schedule.id && (!old || old.websiteId !== a.schedule.websiteId)) throw new WorkspaceError("Schedule not found."); if (!old && s.schedules.length >= 1500) throw new WorkspaceError("Schedule limit reached."); const next: ScheduleRecord = { id: old?.id ?? randomUUID(), ...defaults(a.schedule), enabled: true, cadence: "daily", time: "09:00", timezone: "Asia/Kolkata", weekday: 1, ...old, ...a.schedule, nextRunAt: now }; if (!schedule(next)) throw new WorkspaceError("Invalid schedule settings."); next.nextRunAt = nextScheduleRun(next); s.schedules = [next, ...s.schedules.filter(x => x.id !== next.id)]; break; }
        case "delete-schedule": s.schedules = s.schedules.filter(x => x.id !== a.id); break;
        case "read-notifications": s.notifications.forEach(x => { x.read = true; }); break;
        case "save-report": requireSite(s, a.websiteId); s.reports.unshift({ id: randomUUID(), websiteId: a.websiteId, fetchedAt: now, days: a.days, data: a.data }); break;
        case "import-screaming-frog": {
          const site = requireSite(s, a.websiteId);
          const rootDomain = site.domain.toLowerCase().replace(/^www\./, "");
          if (a.crawl.pages.some(page => { try { const host = new URL(page.url).hostname.toLowerCase().replace(/^www\./, ""); return host !== rootDomain && !host.endsWith(`.${rootDomain}`); } catch { return true; } })) throw new WorkspaceError("The imported URLs must belong to the selected website.");
          s.crawls.unshift({ ...a.crawl, id: randomUUID(), websiteId: site.id, siteUrl: site.url });
          break;
        }
        case "restore": { if (s.jobs.some(x => x.status === "running")) throw new WorkspaceError("Wait for the running job before restoring.", 409); const restored = structuredClone(a.backup) as AppSnapshot; const revision = s.revision; Object.assign(s, restored, { revision, runner: { active: false, localOnly: true } }); s.jobs.forEach(x => { if (["queued", "running"].includes(x.status)) { x.status = "failed"; x.completedAt = now; x.summary = "Restored historical job; enqueue again to run."; } }); s.schedules.forEach(x => { x.enabled = false; }); break; }
        case "import-legacy": {
          if (s.migrationComplete) throw new WorkspaceError("Legacy workspace has already been imported.", 409);
          let old;
          try { old = parseLiveWorkspace(a.raw, true); } catch { throw new WorkspaceError("Invalid legacy workspace. Original data has been preserved."); }
          if (s.sites.length + old.websites.length > 500) throw new WorkspaceError("Import exceeds the 500 website limit.");
          for (const site of old.websites) {
            let siteUrl = normalizeWebsiteUrl(site.domain);
            const bindings = old.bindings[site.id] ?? { siteUrl: "", propertyId: "" };
            if (!binding(bindings)) throw new WorkspaceError("Invalid legacy Google bindings.");
            // Old versions stripped www. Recover it from the user's explicit URL-prefix binding when equivalent.
            if (/^https?:\/\//.test(bindings.siteUrl)) {
              const bound = new URL(bindings.siteUrl);
              if (bound.hostname.replace(/^www\./, "") === site.domain.replace(/^www\./, "")) siteUrl = normalizeWebsiteUrl(bindings.siteUrl);
            }
            if (s.sites.some(x => x.id === site.id || x.url === siteUrl)) throw new WorkspaceError("Import contains an existing website.");
            s.sites.push({ ...site, url: siteUrl, domain: new URL(siteUrl).hostname, archived: false, createdAt: now, bindings });
            for (const audit of old.audits.filter(x => x.domain === site.domain)) {
              s.crawls.push({ id: audit.id, websiteId: site.id, siteUrl, startedAt: audit.scannedAt, completedAt: audit.scannedAt, score: audit.score, pages: [], issues: audit.checks.filter(x => x.status !== "pass").map(x => ({ id: `${x.id}-${audit.domain}`, code: x.id, title: x.title, severity: x.status === "fail" ? "critical" : x.status === "warning" ? "warning" : "info", url: audit.url, detail: x.detail, recommendation: x.recommendation ?? "", change: "new" })), limitations: ["Imported legacy homepage-only audit; detailed page records were not available."], requests: 1 });
            }
            for (const run of old.runs.filter(x => x.websiteId === site.id)) {
              s.jobs.push({ id: run.id, websiteId: site.id, kind: "audit", status: run.status, createdAt: run.startedAt, startedAt: run.startedAt, completedAt: run.completedAt, attempt: 1, summary: "Imported legacy homepage audit receipt.", ...(run.error ? { error: run.error } : {}), ...(run.auditId ? { resultId: run.auditId } : {}), ...defaults({ websiteId: site.id, kind: "audit" }) });
            }
          }
          s.migrationComplete = true;
          break;
        }
      }
    }, a.action === "restore");
    return getSnapshot();
  }
  const replaceSnapshot = (snapshot: AppSnapshot): void => {
    validateSnapshot(snapshot);
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(JSON.stringify(snapshot));
  };
  return { getSnapshot, dispatch, enqueueJob, mutate, replaceSnapshot, close: () => db.close(), recoveryCount: () => Number(db.prepare("SELECT count(*) AS count FROM recovery_snapshots").get()!.count) };
}
export type OrbitStore = ReturnType<typeof createStore>;
const globalStore = globalThis as typeof globalThis & { orbitStore?: OrbitStore };
export function getStore(): OrbitStore { return globalStore.orbitStore ??= createStore(join(process.env.ORBIT_DATA_DIR || join(process.cwd(), ".data"), "orbit.sqlite")); }
export function getSnapshot(): AppSnapshot { return getStore().getSnapshot(); }
export function enqueueJob(input: JobInput): JobRecord { return getStore().enqueueJob(input); }
