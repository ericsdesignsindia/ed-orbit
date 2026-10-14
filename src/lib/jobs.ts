import { randomUUID } from "node:crypto";
import type { AppSnapshot, CrawlResult, JobRecord, NotificationRecord, SeoIssue } from "./contracts";
import type { GoogleReport } from "./google";
import { getStore, isGoogleReport, type OrbitStore } from "./store";
import { nextScheduleRun } from "./scheduler";

export function compareIssues(current: SeoIssue[], previous: SeoIssue[], reassessed?: Set<string>, fullPreviousCoverage = true): SeoIssue[] {
  const existing = new Set(previous.filter(x => x.change !== "resolved").map(x => x.id));
  const ids = new Set(current.map(x => x.id));
  const crossPage = new Set(["duplicate-title", "duplicate-description", "broken-internal-link", "canonical-unindexable", "canonical-chain"]);
  return [...current.map(x => ({ ...x, change: existing.has(x.id) ? "ongoing" as const : "new" as const })), ...previous.filter(x => !ids.has(x.id)).map(x => ({ ...x, change: x.change === "resolved" || ((!reassessed || reassessed.has(x.url)) && (!crossPage.has(x.code) || fullPreviousCoverage)) ? "resolved" as const : "not-rechecked" as const }))];
}
export function trafficMessage(data: GoogleReport, job: Pick<JobRecord, "dropPercent" | "minClicks">): string {
  const comparison = data.comparison;
  if (!data.gsc || !comparison || comparison.previous.clicks < job.minClicks || comparison.previous.clicks === 0) return "Traffic checked; no alert: a comparable previous period with sufficient click volume is unavailable.";
  const drop = (comparison.previous.clicks - data.gsc.clicks) / comparison.previous.clicks * 100;
  return drop >= job.dropPercent ? `Traffic alert: Search Console clicks dropped ${drop.toFixed(1)}% (${comparison.previous.clicks} to ${data.gsc.clicks}) versus the previous period.` : `Traffic checked: no qualifying drop (threshold ${job.dropPercent}%, minimum previous clicks ${job.minClicks}).`;
}
type Dependencies = {
  crawl: (url: string, options: { maxPages: number }) => Promise<CrawlResult>;
  report: (input: { siteUrl?: string; propertyId?: string; days: 7 | 30 | 90 }) => Promise<GoogleReport>;
  email: (to: string, title: string, message: string) => Promise<"sent" | "failed" | "not-configured">;
  now: () => Date;
};
async function sendEmail(to: string, title: string, message: string): Promise<"sent" | "failed" | "not-configured"> {
  const env = process.env;
  if (!env.SMTP_HOST || !env.SMTP_FROM) return "not-configured";
  try {
    const { default: nodemailer } = await import("nodemailer");
    const port = Number(env.SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "failed";
    const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}), connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
    try { await transport.sendMail({ from: env.SMTP_FROM, to, subject: title, text: message }); } finally { transport.close(); }
    return "sent";
  } catch { return "failed"; }
}
const defaults: Dependencies = {
  crawl: async (url, options) => (await import("./crawler")).runCrawl(url, options),
  report: async input => (await import("./google")).fetchStoredGoogleReport(input),
  email: sendEmail,
  now: () => new Date(),
};
const transient = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; code?: string; name?: string; retryable?: boolean };
  if (typeof e.retryable === "boolean") return e.retryable;
  return [429, 502, 503, 504].includes(e.status ?? 0) || ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(e.code ?? "") || e.name === "TimeoutError";
};

/** One worker per server process. All transitions are durable before any network work. */
type RunnerStore = {
  getSnapshot: () => AppSnapshot | Promise<AppSnapshot>;
  mutate: <T>(fn: (snapshot: AppSnapshot) => T, backup?: boolean) => T | Promise<T>;
};
export function createRunner(store: OrbitStore | RunnerStore, supplied: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...supplied };
  let busy = false;
  let initialized = false;
  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const now = deps.now();
      await store.mutate(s => {
        if (!initialized) {
          for (const job of s.jobs.filter(x => x.status === "running")) {
            job.status = job.attempt >= 3 ? "failed" : "queued";
            job.summary = job.attempt >= 3 ? "Interrupted after the maximum attempts." : "Recovering interrupted work after server restart.";
            if (job.status === "failed") {
              job.completedAt = now.toISOString();
              s.notifications.unshift({ id: randomUUID(), websiteId: job.websiteId, createdAt: job.completedAt, title: "Interrupted work could not recover", message: job.summary, read: false, jobId: job.id });
            }
          }
        }
        s.runner = { active: true, lastTickAt: now.toISOString(), localOnly: true };
        for (const schedule of s.schedules) {
          if (!schedule.enabled || Date.parse(schedule.nextRunAt) > now.getTime() || !s.sites.some(x => x.id === schedule.websiteId && !x.archived)) continue;
          if (!s.jobs.some(x => x.websiteId === schedule.websiteId && x.kind === schedule.kind && ["queued", "running"].includes(x.status))) {
            s.jobs.unshift({ id: randomUUID(), websiteId: schedule.websiteId, kind: schedule.kind, status: "queued", createdAt: now.toISOString(), attempt: 0, summary: "Scheduled by the local server.", scheduleId: schedule.id, maxPages: schedule.maxPages, days: schedule.days, dropPercent: schedule.dropPercent, minClicks: schedule.minClicks, ...(schedule.notificationEmail ? { notificationEmail: schedule.notificationEmail } : {}) });
          }
          schedule.lastRunAt = now.toISOString();
          schedule.nextRunAt = nextScheduleRun(schedule, now);
        }
      });
      initialized = true;
      const pending = (await store.getSnapshot()).jobs.filter(x => x.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!pending) return;
      const job = await store.mutate(s => { const job = s.jobs.find(x => x.id === pending.id); if (!job || job.status !== "queued") return undefined; job.status = "running"; job.startedAt = deps.now().toISOString(); job.attempt++; job.summary = "Running on the app server."; delete job.error; return structuredClone(job); });
      if (!job) return;
      let notification: NotificationRecord | undefined;
      try {
        const site = (await store.getSnapshot()).sites.find(x => x.id === job.websiteId)!;
        const result = job.kind === "audit" ? await deps.crawl(site.url, { maxPages: job.maxPages }) : await deps.report({ ...(site.bindings.siteUrl ? { siteUrl: site.bindings.siteUrl } : {}), ...(site.bindings.propertyId ? { propertyId: site.bindings.propertyId } : {}), days: job.days });
        if (job.kind !== "audit") {
          if (!isGoogleReport(result)) throw new Error("Invalid Google report.");
          const data = result as GoogleReport;
          if ((!data.gsc && !data.ga4) || (job.kind === "traffic-alert" && (!data.gsc || !data.comparison))) {
            const error = new Error("Required reporting sources were unavailable.") as Error & { retryable: boolean };
            error.retryable = data.retryable === true; throw error;
          }
        }
        notification = await store.mutate(s => {
          const record = s.jobs.find(x => x.id === job.id)!;
          let summary: string;
          if (job.kind === "audit") {
            const crawl = result as CrawlResult;
            const previous = s.crawls.find(x => x.websiteId === site.id);
            const observed = new Set(crawl.pages.filter(p => p.status > 0 && !p.error).flatMap(p => [p.url, p.finalUrl]));
            const fullPreviousCoverage = !previous || previous.pages.every(p => observed.has(p.url));
            const saved = { ...crawl, websiteId: site.id, siteUrl: site.url, issues: compareIssues(crawl.issues, previous?.issues ?? [], observed, fullPreviousCoverage) };
            s.crawls.unshift(saved); record.resultId = saved.id;
            summary = observed.size ? `Audit complete: ${crawl.pages.length} page records, observed score ${crawl.score}/100, ${crawl.issues.length} current findings.` : "Crawl finished without inspectable HTML. SEO assessment is unavailable; review the recorded access errors and limitations.";
          } else {
            const data = result as GoogleReport;
            if (!data.gsc && !data.ga4) throw new Error("Google report has no available sources.");
            const report = { id: randomUUID(), websiteId: site.id, fetchedAt: deps.now().toISOString(), days: job.days, data };
            s.reports.unshift(report); record.resultId = report.id;
            summary = job.kind === "traffic-alert" ? trafficMessage(data, job) : `Google report saved for ${data.startDate} through ${data.endDate}.${data.errors?.length ? " Some sources were unavailable." : ""}`;
          }
          record.status = "success"; record.completedAt = deps.now().toISOString(); record.summary = summary;
          const note: NotificationRecord = { id: randomUUID(), websiteId: site.id, createdAt: record.completedAt, title: `${site.name}: ${job.kind === "audit" ? "Audit complete" : job.kind === "traffic-alert" ? "Traffic check" : "Report ready"}`, message: summary, read: false, jobId: job.id, ...(job.notificationEmail ? { emailStatus: "not-configured" as const } : {}) };
          s.notifications.unshift(note); return note;
        });
      } catch (error) {
        await store.mutate(s => {
          const record = s.jobs.find(x => x.id === job.id)!;
          if (transient(error) && record.attempt < 3) { record.status = "queued"; record.summary = `Temporary service failure; retry ${record.attempt + 1}/3 on the next runner tick.`; return; }
          record.status = "failed"; record.completedAt = deps.now().toISOString(); record.error = "The job could not complete. Check the website, Google connection and property bindings, then retry."; record.summary = record.error;
          const note: NotificationRecord = { id: randomUUID(), websiteId: record.websiteId, createdAt: record.completedAt, title: "Scheduled work failed", message: record.error, read: false, jobId: record.id };
          s.notifications.unshift(note); notification = note;
        });
      }
      // Delivery is deliberately outside the audit transaction/retry block.
      if (notification && job.notificationEmail) {
        let status: "sent" | "failed" | "not-configured";
        try { status = await deps.email(job.notificationEmail, notification.title, notification.message); } catch { status = "failed"; }
        await store.mutate(s => { const note = s.notifications.find(x => x.id === notification!.id); if (note) note.emailStatus = status; });
      }
    } finally { busy = false; }
  }
  return { tick, isBusy: () => busy };
}
type Running = { runner: ReturnType<typeof createRunner>; timer: ReturnType<typeof setInterval> };
const globals = globalThis as typeof globalThis & { orbitRunner?: Running };
export function ensureRunner(): void {
  if (globals.orbitRunner || process.env.NEXT_PHASE === "phase-production-build") return;
  const runner = createRunner(getStore());
  const safeTick = () => { void runner.tick().catch(() => { /* Never log payloads, credentials or upstream errors. Next tick may recover. */ }); };
  const timer = setInterval(safeTick, 15000); timer.unref();
  globals.orbitRunner = { runner, timer }; safeTick();
}
