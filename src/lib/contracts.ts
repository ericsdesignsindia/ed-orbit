import type { GoogleReport } from "./google";

export type SiteRecord = { id: string; name: string; url: string; domain: string; archived: boolean; createdAt: string; bindings: { siteUrl: string; propertyId: string } };
export type SeoIssue = { id: string; code: string; title: string; severity: "critical" | "warning" | "info"; url: string; detail: string; recommendation: string; change?: "new" | "ongoing" | "resolved" | "not-rechecked" };
export type CrawlPage = { url: string; finalUrl: string; status: number; title: string; description: string; canonical: string; h1Count: number; noindex: boolean; internalLinks: string[]; redirectCount: number; error?: string };
export type CrawlResult = { id: string; siteUrl: string; startedAt: string; completedAt: string; score: number; pages: CrawlPage[]; issues: SeoIssue[]; limitations: string[]; requests: number };
export type SavedCrawl = CrawlResult & { websiteId: string };
export type SavedReport = { id: string; websiteId: string; fetchedAt: string; days: 7 | 30 | 90; data: GoogleReport };
export type JobKind = "audit" | "report" | "traffic-alert";
export type ScheduleRecord = { id: string; websiteId: string; kind: JobKind; enabled: boolean; cadence: "daily" | "weekly"; time: string; timezone: string; weekday: number; nextRunAt: string; lastRunAt?: string; maxPages: number; days: 7 | 30 | 90; dropPercent: number; minClicks: number; notificationEmail?: string };
export type JobRecord = { id: string; websiteId: string; kind: JobKind; status: "queued" | "running" | "success" | "failed"; createdAt: string; startedAt?: string; completedAt?: string; attempt: number; summary: string; error?: string; resultId?: string; scheduleId?: string; maxPages: number; days: 7 | 30 | 90; dropPercent: number; minClicks: number; notificationEmail?: string };
export type NotificationRecord = { id: string; websiteId: string; createdAt: string; title: string; message: string; read: boolean; emailStatus?: "sent" | "failed" | "not-configured"; jobId?: string };
export type AppSnapshot = { version: 2; revision: number; sites: SiteRecord[]; crawls: SavedCrawl[]; reports: SavedReport[]; jobs: JobRecord[]; schedules: ScheduleRecord[]; notifications: NotificationRecord[]; runner: { active: boolean; lastTickAt?: string; localOnly: true }; migrationComplete: boolean };

/** All POST /api/workspace actions return the current AppSnapshot. */
export type WorkspaceAction =
  | { action: "add-site"; url: string; name?: string }
  | { action: "update-site"; id: string; name?: string; archived?: boolean; bindings?: SiteRecord["bindings"] }
  | { action: "delete-site"; id: string; confirmed: true }
  | { action: "enqueue"; websiteId: string; kind: JobKind; maxPages?: number; days?: 7 | 30 | 90; dropPercent?: number; minClicks?: number }
  | { action: "save-schedule"; schedule: Partial<ScheduleRecord> & { websiteId: string; kind: JobKind } }
  | { action: "delete-schedule"; id: string }
  | { action: "read-notifications" }
  | { action: "save-report"; websiteId: string; days: 7 | 30 | 90; data: GoogleReport }
  | { action: "import-legacy"; raw: string }
  | { action: "restore"; backup: unknown; confirmed: true };
