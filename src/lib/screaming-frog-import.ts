import type { CrawlPage, SeoIssue, SiteRecord } from "./contracts";

export type ScreamingFrogImport = {
  source: "screaming-frog";
  startedAt: string;
  completedAt: string;
  score: number;
  pages: CrawlPage[];
  issues: SeoIssue[];
  limitations: string[];
  requests: number;
};

type CsvRow = Record<string, string>;

function parseCsv(input: string): CsvRow[] {
  const text = input.replace(/^\uFEFF/, "");
  if (text.length > 5 * 1024 * 1024) throw new Error("Choose a Screaming Frog CSV smaller than 5 MB.");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell); cell = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted field. Re-export it from Screaming Frog as CSV.");
  if (cell || row.length) { row.push(cell); if (row.some(value => value.trim())) rows.push(row); }
  if (rows.length < 2) throw new Error("The CSV has no crawl rows.");
  const headers = rows[0].map(value => value.trim());
  const normalized = headers.map(value => value.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error("The CSV contains duplicate column names. Export a single Screaming Frog tab, such as Internal: All.");
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])));
}

const field = (row: CsvRow, name: string) => row[Object.keys(row).find(key => key.toLowerCase() === name.toLowerCase()) ?? ""] ?? "";
const num = (value: string, fallback = 0) => { const parsed = Number(value.replaceAll(",", "")); return Number.isFinite(parsed) ? parsed : fallback; };
const cleanUrl = (value: string) => { try { const parsed = new URL(value); return /^https?:$/.test(parsed.protocol) ? parsed.href : ""; } catch { return ""; } };
function belongsToSite(url: string, site: SiteRecord): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const expected = site.domain.toLowerCase().replace(/^www\./, "");
    return host === expected || host.endsWith(`.${expected}`);
  } catch { return false; }
}

export function parseScreamingFrogExport(input: string, site: SiteRecord, importedAt = new Date().toISOString()): ScreamingFrogImport {
  const rows = parseCsv(input);
  const headers = Object.keys(rows[0]);
  const has = (...names: string[]) => names.some(name => headers.some(header => header.toLowerCase() === name.toLowerCase()));
  if (!has("Address", "URL") || !has("Status Code", "Response Code")) throw new Error("Use a Screaming Frog Internal: All export with Address and Status Code columns.");
  const h1Headers = headers.filter(header => /^h1(?:\s*[-_]\s*\d+)?$/i.test(header));
  const hasTitle = has("Title 1", "Page Title");
  const hasDescription = has("Meta Description 1", "Meta Description");
  const hasIndexability = has("Indexability", "Indexability Status", "Meta Robots 1", "X-Robots-Tag 1");
  const hasCanonical = has("Canonical Link Element 1", "Canonical Link Element");
  if (rows.length > 10000) throw new Error("This import is limited to 10,000 URLs. Use Screaming Frog filters or split the export into smaller reports.");

  const pages: CrawlPage[] = [];
  const issues: SeoIssue[] = [];
  const addIssue = (page: CrawlPage, code: string, severity: SeoIssue["severity"], title: string, detail: string, recommendation: string) => {
    if (issues.length >= 20000) return;
    issues.push({ id: `sf-${issues.length + 1}`, code, title, severity, url: page.url, detail, recommendation, change: "new" });
  };
  for (const row of rows) {
    const url = cleanUrl(field(row, "Address") || field(row, "URL"));
    if (!url || !belongsToSite(url, site)) continue;
    const status = num(field(row, "Status Code") || field(row, "Response Code"), -1);
    if (!Number.isInteger(status) || status < 0 || status > 599) continue;
    const title = field(row, "Title 1") || field(row, "Page Title");
    const description = field(row, "Meta Description 1") || field(row, "Meta Description");
    const canonical = cleanUrl(field(row, "Canonical Link Element 1") || field(row, "Canonical Link Element"));
    const indexabilityText = [field(row, "Indexability"), field(row, "Indexability Status"), field(row, "Meta Robots 1"), field(row, "X-Robots-Tag 1")].join(" ").toLowerCase();
    const noindex = /\bnoindex\b/.test(indexabilityText);
    const h1Count = h1Headers.reduce((count, header) => count + (field(row, header) ? 1 : 0), 0);
    const contentType = field(row, "Content Type").toLowerCase();
    const page: CrawlPage = { url, finalUrl: cleanUrl(field(row, "Redirect URL")) || url, status, title, description, canonical, h1Count, noindex, internalLinks: [], redirectCount: field(row, "Redirect URL") ? 1 : 0, ...(contentType && !contentType.includes("html") ? { error: `Non-HTML resource (${contentType}); page-level HTML checks are unavailable.` } : {}) };
    pages.push(page);
    if (status >= 400) addIssue(page, "sf-http-error", status >= 500 ? "critical" : "warning", `HTTP ${status}`, `Screaming Frog reported status ${status}.`, "Restore the URL or update internal links to a suitable destination.");
    if (noindex) addIssue(page, "sf-noindex", "warning", "Noindex directive", "Screaming Frog detected a noindex directive for this URL.", "Confirm whether this URL should be excluded from search indexing.");
    if (status >= 200 && status < 300 && !page.error) {
      if (hasTitle && !title) addIssue(page, "sf-missing-title", "warning", "Missing page title", "The export contains no title for this page.", "Add a unique, descriptive title that reflects the page content.");
      if (hasDescription && !description) addIssue(page, "sf-missing-description", "info", "Missing meta description", "The export contains no meta description for this page.", "Add a concise description where it improves the search snippet.");
      if (h1Headers.length && !h1Count) addIssue(page, "sf-missing-h1", "info", "Missing H1 heading", "No H1 value was present in the exported columns.", "Review the page heading hierarchy and add a clear primary heading if appropriate.");
      if (hasCanonical && !canonical) addIssue(page, "sf-missing-canonical", "info", "Canonical not exported", "No canonical URL value was present in the export.", "Review the page’s canonical configuration if the site needs an explicit preferred URL.");
    }
  }
  if (!pages.length) throw new Error("No URLs in this export matched the selected website. Check the website selector and Screaming Frog crawl scope.");
  const duplicateGroups = (key: "title" | "description") => {
    const values = new Map<string, CrawlPage[]>();
    for (const page of pages) if (page.status >= 200 && page.status < 300 && !page.error && page[key]) {
      const normalized = page[key].toLowerCase().trim();
      const group = values.get(normalized);
      if (group) group.push(page); else values.set(normalized, [page]);
    }
    for (const group of values.values()) if (group.length > 1) for (const page of group) addIssue(page, `sf-duplicate-${key}`, "warning", `Duplicate ${key === "title" ? "page title" : "meta description"}`, `This value is shared by ${group.length} exported URLs.`, "Review whether affected pages need unique metadata or should be consolidated.");
  };
  if (hasTitle) duplicateGroups("title");
  if (hasDescription) duplicateGroups("description");

  const inspected = pages.filter(page => page.status >= 200 && page.status < 300 && !page.error);
  const weights = { critical: 20, warning: 8, info: 2 };
  const deductions = new Map<string, number>();
  for (const issue of issues) deductions.set(issue.url, (deductions.get(issue.url) ?? 0) + weights[issue.severity]);
  const score = inspected.length ? Math.round(inspected.reduce((sum, page) => sum + Math.max(0, 100 - (deductions.get(page.url) ?? 0)), 0) / inspected.length) : 0;
  const limitations = [
    "Source: Screaming Frog SEO Spider CSV export. The desktop spider performed the crawl; SIGNAL imported its exported page rows and derived findings from columns present in this file.",
    "Imported timestamp is recorded here because the selected CSV tab does not provide a reliable crawl completion time.",
    "The Internal: All export does not include the complete inlinks graph. Export additional Screaming Frog link reports for link-level analysis.",
    ...(!hasIndexability ? ["Indexability and robots directives were not included; indexing status is unknown for these rows."] : []),
    ...(!hasCanonical ? ["Canonical URL columns were not included; canonical status is unknown."] : []),
    ...(h1Headers.length ? [] : ["H1 columns were not included; heading status is unknown."]),
    ...(!hasTitle ? ["Page title columns were not included; title status is unknown."] : []),
    ...(!hasDescription ? ["Meta description columns were not included; description status is unknown."] : []),
    ...(rows.length > pages.length ? `${rows.length - pages.length} rows with invalid, unsupported, or out-of-scope URLs/status codes were skipped.` : []),
  ];
  return { source: "screaming-frog", startedAt: importedAt, completedAt: importedAt, score, pages, issues, limitations, requests: pages.length };
}
