/** Local-only workspace data. Nothing in this module performs network requests. */
export interface Website {
  id: string;
  name: string;
  domain: string;
  isDemo: boolean;
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface Run {
  id: string;
  automationId: string;
  websiteId: string;
  startedAt: string;
  status: "demo";
  summary: string;
}

export interface Workspace {
  version: 1;
  websites: Website[];
  selectedWebsiteId: string;
  automations: Automation[];
  runs: Run[];
  dismissedOpportunityIds: string[];
}

export const STORAGE_KEY = "seo-command-center.workspace.v1";
const HISTORY_LIMIT = 50;

export function createInitialWorkspace(): Workspace {
  return {
    version: 1,
    websites: [{ id: "acme-studio", name: "Acme Studio", domain: "example.com", isDemo: true }],
    selectedWebsiteId: "acme-studio",
    automations: [
      { id: "weekly-report", name: "Weekly performance digest", description: "Preview a weekly summary of sample search performance and suggested next steps.", enabled: true },
      { id: "ranking-alerts", name: "Ranking change alerts", description: "Explore example alerts for keyword position changes using demo data.", enabled: true },
      { id: "content-opportunities", name: "Content opportunity finder", description: "Preview sample content ideas and potential page improvements.", enabled: false },
      { id: "technical-audit", name: "Technical health check", description: "Preview an illustrative checklist for indexing and page health.", enabled: false },
    ],
    runs: [],
    dismissedOpportunityIds: [],
  };
}

/** Accept a public-looking DNS name or HTTP(S) URL, canonicalizing www and case.
 * This is syntax validation, not DNS resolution or an SSRF security boundary.
 */
export function normalizeDomain(input: string): string {
  if (typeof input !== "string" || !input.trim()) throw new Error("Enter a website domain.");
  const value = input.trim();
  if (/\s|\\/.test(value)) throw new Error("Enter a valid domain or HTTP(S) URL.");
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) throw new Error("Only HTTP and HTTPS websites are supported.");
  if (!hasScheme && /[/?#:@]/.test(value)) throw new Error("Enter a bare domain or a complete HTTP(S) URL.");
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    throw new Error("Enter a valid website domain.");
  }
  const authority = value.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  if (!authority) throw new Error("Enter a valid website URL.");
  if (url.username || url.password || authority.includes("@")) throw new Error("URLs with credentials are not supported.");
  if (url.port) throw new Error("Custom website ports are not supported.");
  const domain = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const labels = domain.split(".");
  const last = labels[labels.length - 1];
  if (
    domain.length > 253 || labels.length < 2 ||
    labels.some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) ||
    !/^(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/.test(last) ||
    /^(?:localhost|local|internal|intranet|lan|home|test|invalid|onion)$/.test(last) ||
    domain === "home.arpa" || domain.endsWith(".home.arpa")
  ) {
    throw new Error("Use a public website domain, not an IP address or local hostname.");
  }
  return domain;
}

function newId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function addWebsite(state: Workspace, input: string, name?: string): Workspace {
  const domain = normalizeDomain(input);
  if (state.websites.some((site) => site.domain === domain)) throw new Error("This website is already in your workspace.");
  const displayName = name?.trim() || domain;
  if (displayName.length > 200) throw new Error("Website names must be 200 characters or fewer.");
  const website: Website = { id: newId("site"), name: displayName, domain, isDemo: false };
  return { ...state, websites: [...state.websites, website], selectedWebsiteId: website.id };
}

export function toggleAutomation(state: Workspace, id: string): Workspace {
  if (!state.automations.some((automation) => automation.id === id)) throw new Error("Unknown automation.");
  return { ...state, automations: state.automations.map((automation) => automation.id === id ? { ...automation, enabled: !automation.enabled } : automation) };
}

export function simulateRun(state: Workspace, automationId: string): Workspace {
  const automation = state.automations.find((item) => item.id === automationId);
  if (!automation) throw new Error("Unknown automation.");
  if (!automation.enabled) throw new Error("Enable this automation before running a demo.");
  const website = state.websites.find((item) => item.id === state.selectedWebsiteId);
  if (!website) throw new Error("Select a website before running a demo.");
  const run: Run = {
    id: newId("run"), automationId, websiteId: website.id,
    startedAt: new Date().toISOString(), status: "demo",
    summary: `DEMO ONLY: ${automation.name} preview for ${website.domain}. No website was scanned, no Google data was accessed, and no external action was executed.`,
  };
  return { ...state, runs: [run, ...state.runs].slice(0, HISTORY_LIMIT) };
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 2000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/** Discard malformed or incompatible saves in full instead of trusting partial state. */
export function parseWorkspace(raw: string | null): Workspace {
  try {
    if (!raw || raw.length > 2_000_000) return createInitialWorkspace();
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !Array.isArray(value.websites) || !value.websites.length ||
      !Array.isArray(value.automations) || !value.automations.length || !Array.isArray(value.runs) ||
      !Array.isArray(value.dismissedOpportunityIds) || !text(value.selectedWebsiteId, 200)) throw new Error("Invalid workspace.");
    const websites: Website[] = value.websites.map((site: unknown) => {
      if (!record(site) || !text(site.id, 200) || !text(site.name, 200) || !text(site.domain, 253) ||
        typeof site.isDemo !== "boolean" || normalizeDomain(site.domain) !== site.domain) throw new Error("Invalid website.");
      return { id: site.id, name: site.name, domain: site.domain, isDemo: site.isDemo };
    });
    const automations: Automation[] = value.automations.map((item: unknown) => {
      if (!record(item) || !text(item.id, 200) || !text(item.name, 200) || !text(item.description) || typeof item.enabled !== "boolean") throw new Error("Invalid automation.");
      return { id: item.id, name: item.name, description: item.description, enabled: item.enabled };
    });
    if (!uniqueIds(websites) || !uniqueIds(automations) || new Set(websites.map((site) => site.domain)).size !== websites.length ||
      !websites.some((site) => site.id === value.selectedWebsiteId)) throw new Error("Invalid identifiers.");
    const runs: Run[] = value.runs.map((item: unknown) => {
      if (!record(item) || !text(item.id, 200) || !text(item.automationId, 200) || !text(item.websiteId, 200) ||
        !text(item.startedAt, 40) || !text(item.summary) || item.status !== "demo" ||
        !automations.some((automation) => automation.id === item.automationId) || !websites.some((site) => site.id === item.websiteId) ||
        new Date(item.startedAt).toISOString() !== item.startedAt) throw new Error("Invalid run.");
      return { id: item.id, automationId: item.automationId, websiteId: item.websiteId, startedAt: item.startedAt, status: "demo", summary: item.summary };
    });
    if (!uniqueIds(runs) || !value.dismissedOpportunityIds.every((id: unknown) => text(id, 200)) ||
      new Set(value.dismissedOpportunityIds).size !== value.dismissedOpportunityIds.length) throw new Error("Invalid history.");
    return { version: 1, websites, selectedWebsiteId: value.selectedWebsiteId, automations, runs: runs.slice(0, HISTORY_LIMIT), dismissedOpportunityIds: [...value.dismissedOpportunityIds] };
  } catch {
    return createInitialWorkspace();
  }
}

export function serializeWorkspace(state: Workspace): string {
  return JSON.stringify(state);
}
