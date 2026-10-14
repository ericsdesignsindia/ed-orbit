import { normalizeDomain } from "./workspace";
import type { AuditResult } from "./audit";

export type Site = { id: string; name: string; domain: string };
export type Binding = { siteUrl: string; propertyId: string };
export type AuditRun = { id: string; websiteId: string; startedAt: string; completedAt: string; status: "success" | "failed"; auditId?: string; error?: string };
export type LiveWorkspace = { version: 1; websites: Site[]; selectedId: string; audits: AuditResult[]; runs: AuditRun[]; bindings: Record<string, Binding> };
export const LIVE_STORAGE_KEY = "orbit.live-workspace.v1";
export const emptyWorkspace = (): LiveWorkspace => ({ version: 1, websites: [], selectedId: "", audits: [], runs: [], bindings: {} });
function retainPerSite<T>(items: T[], key: (item: T) => string, limit: number): T[] {
  const counts = new Map<string, number>();
  return items.filter(item => { const site = key(item); const count = (counts.get(site) ?? 0) + 1; counts.set(site, count); return count <= limit; });
}

export function addLiveWebsite(state: LiveWorkspace, domainInput: string, name: string): LiveWorkspace {
  if (state.websites.length >= 500) throw new Error("A workspace supports up to 500 websites.");
  const domain = normalizeDomain(domainInput);
  if (state.websites.some(site => site.domain === domain)) throw new Error("This website has already been added.");
  const displayName = name.trim() || domain;
  if (displayName.length > 100) throw new Error("Use a website name of 100 characters or fewer.");
  const site = { id: crypto.randomUUID(), name: displayName, domain };
  return { ...state, websites: [...state.websites, site], selectedId: site.id };
}

export function recordAudit(state: LiveWorkspace, run: AuditRun, audit?: AuditResult): LiveWorkspace {
  if (!state.websites.some(site => site.id === run.websiteId)) throw new Error("Website no longer exists.");
  if (run.status === "success" && (!audit || run.auditId !== audit.id || state.websites.find(site => site.id === run.websiteId)?.domain !== audit.domain)) throw new Error("Audit does not match its website.");
  return { ...state, runs: retainPerSite([run, ...state.runs], x => x.websiteId, 50), audits: audit ? retainPerSite([audit, ...state.audits], x => x.domain, 30) : state.audits };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 2000): value is string => typeof value === "string" && value.length <= max;
const date = (value: unknown): value is string => text(value, 40) && Number.isFinite(Date.parse(value));
export function isAudit(value: unknown): value is AuditResult {
  if (!object(value) || !text(value.id, 100) || !text(value.domain, 253) || !text(value.url, 4096) || !/^https?:\/\//.test(value.url) || !date(value.scannedAt) || typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 100 || value.pagesChecked !== 1 || typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 || !Array.isArray(value.checks) || value.checks.length > 100) return false;
  return value.checks.every(check => object(check) && text(check.id, 100) && text(check.title, 300) && ["pass", "warning", "fail", "info"].includes(String(check.status)) && text(check.detail, 10000) && (check.recommendation === undefined || text(check.recommendation, 2000)));
}

export function parseLiveWorkspace(raw: string | null, strict = false): LiveWorkspace {
  if (!raw) { if (strict) throw new Error("Invalid legacy workspace. Original data has been preserved."); return emptyWorkspace(); }
  try {
    if (raw.length > 4_000_000) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || !Array.isArray(value.websites) || value.websites.length > 500 || !text(value.selectedId, 100) || !Array.isArray(value.audits) || !Array.isArray(value.runs) || !object(value.bindings)) throw new Error();
    const sites = value.websites.map((site: unknown) => {
      if (!object(site) || !text(site.id, 100) || !site.id || !text(site.name, 100) || !site.name.trim() || !text(site.domain, 253) || normalizeDomain(site.domain) !== site.domain) throw new Error();
      return { id: site.id, name: site.name, domain: site.domain };
    });
    if (new Set(sites.map(site => site.id)).size !== sites.length || new Set(sites.map(site => site.domain)).size !== sites.length || (sites.length ? !sites.some(site => site.id === value.selectedId) : value.selectedId !== "")) throw new Error();
    if (!value.audits.every(audit => isAudit(audit) && sites.some(site => site.domain === audit.domain))) throw new Error();
    const runs = value.runs.map((run: unknown): AuditRun => {
      if (!object(run) || !text(run.id, 100) || !text(run.websiteId, 100) || !sites.some(site => site.id === run.websiteId) || !date(run.startedAt) || !date(run.completedAt) || (run.status !== "success" && run.status !== "failed") || (run.auditId !== undefined && !text(run.auditId, 100)) || (run.error !== undefined && !text(run.error, 2000))) throw new Error();
      return { id: run.id, websiteId: run.websiteId, startedAt: run.startedAt, completedAt: run.completedAt, status: run.status, ...(typeof run.auditId === "string" ? { auditId: run.auditId } : {}), ...(typeof run.error === "string" ? { error: run.error } : {}) };
    });
    const bindings: Record<string, Binding> = {};
    for (const site of sites) {
      const binding = value.bindings[site.id];
      if (binding === undefined) continue;
      if (!object(binding) || !text(binding.siteUrl, 2048) || !text(binding.propertyId, 40)) throw new Error();
      Object.defineProperty(bindings, site.id, { value: { siteUrl: binding.siteUrl, propertyId: binding.propertyId }, enumerable: true, configurable: true, writable: true });
    }
    return { version: 1, websites: sites, selectedId: value.selectedId, audits: retainPerSite(value.audits as AuditResult[], x => x.domain, 30), runs: retainPerSite(runs, x => x.websiteId, 50), bindings };
  } catch { if (strict) throw new Error("Invalid legacy workspace. Original data has been preserved."); return emptyWorkspace(); }
}
