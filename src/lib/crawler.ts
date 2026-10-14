import { createHash, randomUUID } from "node:crypto";
import { load } from "cheerio";
import type { CrawlPage, CrawlResult, SeoIssue } from "./contracts";
import { normalizeWebsiteUrl } from "./site-url";
import { safeFetch, type FetchDependencies, type SafeResponse } from "./safe-fetch";

export const CRAWLER_AGENT = "SEOCommandCenter/EDOrbit";
export type RobotsPolicy = { rules: { pattern: string; allow: boolean }[]; sitemaps: string[]; delayMs: number };
/** Select the longest matching agent group; equally specific groups are combined. */
export function parseRobots(text: string, agent = CRAWLER_AGENT): RobotsPolicy {
  const groups: { agents: string[]; rules: RobotsPolicy["rules"]; delays: number[] }[] = [];
  const sitemaps: string[] = []; let group: typeof groups[number] | undefined; let directives = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(); const split = line.indexOf(":"); if (split < 0) continue;
    const name = line.slice(0, split).trim().toLowerCase(), value = line.slice(split + 1).trim();
    if (name === "sitemap") { if (value) sitemaps.push(value); continue; }
    if (name === "user-agent") {
      if (!group || directives) { group = { agents: [], rules: [], delays: [] }; groups.push(group); directives = false; }
      group.agents.push(value.toLowerCase());
    } else if (group) {
      directives = true;
      if ((name === "allow" || name === "disallow") && value.startsWith("/")) group.rules.push({ pattern: value, allow: name === "allow" });
      if (name === "crawl-delay" && /^\d+(?:\.\d+)?$/.test(value)) group.delays.push(Number(value) * 1000);
    }
  }
  const match = (g: typeof groups[number]) => Math.max(-1, ...g.agents.map(a => a === "*" ? 0 : a && agent.toLowerCase().includes(a) ? a.length : -1));
  const specificity = Math.max(-1, ...groups.map(match)); const selected = groups.filter(g => specificity >= 0 && match(g) === specificity);
  return { rules: selected.flatMap(g => g.rules), sitemaps, delayMs: Math.max(250, ...selected.flatMap(g => g.delays)) };
}
export function robotsAllows(policy: RobotsPolicy, input: string): boolean {
  const url = new URL(input); const path = url.pathname + url.search;
  let longest = -1, allowed = true;
  for (const rule of policy.rules) {
    const end = rule.pattern.endsWith("$"); const value = end ? rule.pattern.slice(0, -1) : rule.pattern;
    const regex = "^" + value.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (end ? "$" : "");
    const length = value.replace(/\*/g, "").length;
    if (new RegExp(regex).test(path) && (length > longest || (length === longest && rule.allow))) { longest = length; allowed = rule.allow; }
  }
  return allowed;
}
function issue(url: string, code: string, severity: SeoIssue["severity"], title: string, detail: string, recommendation: string): SeoIssue {
  return { id: createHash("sha256").update(url + "\n" + code).digest("hex").slice(0, 24), url, code, severity, title, detail, recommendation };
}
export function analyzeCrawlPage(response: SafeResponse, requestedUrl = response.url): { page: CrawlPage; issues: SeoIssue[]; followLinks: boolean } {
  const $ = load(response.body); const meta = (name: string) => $("meta").filter((_, el) => ($(el).attr("name") ?? "").toLowerCase() === name);
  const canonicals = $("link").filter((_, el) => /(?:^|\s)canonical(?:\s|$)/i.test($(el).attr("rel") ?? ""));
  let canonical = ""; try { const value = canonicals.first().attr("href"); if (value) canonical = new URL(value, response.url).href; } catch { /* evidence below */ }
  const directives = [meta("robots").attr("content"), meta("googlebot").attr("content"), response.headers["x-robots-tag"]].join(",");
  const noindex = /(?:^|[\s,:])(?:noindex|none)(?:$|[\s,;])/i.test(directives);
  const followLinks = !/(?:^|[\s,:])(?:nofollow|none)(?:$|[\s,;])/i.test(directives);
  const internalLinks: string[] = [];
  $("a[href]").each((_, node) => { if (/(?:^|\s)nofollow(?:\s|$)/i.test($(node).attr("rel") ?? "")) return; try { const link = new URL($(node).attr("href")!, response.url); link.hash = ""; if (link.origin === new URL(response.url).origin && !internalLinks.includes(link.href)) internalLinks.push(link.href); } catch { /* invalid link */ } });
  const page: CrawlPage = { url: requestedUrl, finalUrl: response.url, status: response.status, title: $("head title").first().text().trim(), description: meta("description").first().attr("content")?.trim() ?? "", canonical, h1Count: $("h1").length, noindex, internalLinks, redirectCount: response.redirects?.length ?? 0 };
  const issues: SeoIssue[] = []; const add = (code: string, severity: SeoIssue["severity"], title: string, detail: string, recommendation: string) => issues.push(issue(page.url, code, severity, title, detail, recommendation));
  if (page.status >= 400) add("http-error", "critical", "HTTP error", `Fetched HTTP ${page.status}.`, "Restore the page or update links to its replacement.");
  if (noindex) add("noindex", "critical", "Indexing disabled", "A noindex/none directive was returned.", "Remove only if this page should be indexed.");
  if (page.status >= 200 && page.status < 300) {
    if (!page.title) add("missing-title", "warning", "Missing title", "No nonempty HTML title found.", "Write a descriptive page title.");
    if (!page.description) add("missing-description", "warning", "Missing description", "No nonempty meta description found.", "Add a useful summary; search engines may choose other snippets.");
    if (!page.h1Count) add("missing-h1", "info", "No primary heading", "No H1 found in static HTML.", "Review the heading structure; there is no absolute single-H1 ranking rule.");
    if (!canonicals.length) add("missing-canonical", "info", "Canonical undeclared", "No HTML canonical declaration found.", "Consider declaring the preferred URL where duplicate versions exist.");
    else if (!canonical || !/^https?:\/\//.test(canonical)) add("invalid-canonical", "warning", "Invalid canonical", "The canonical could not be resolved to HTTP(S).", "Use a valid preferred URL.");
    if (canonicals.length > 1) add("canonical-conflict", "warning", "Multiple canonical declarations", `Found ${canonicals.length} declarations.`, "Use one unambiguous canonical declaration.");
    const missingAlt = $("img").filter((_, image) => $(image).attr("alt") === undefined).length;
    if (missingAlt) add("missing-image-alt", "warning", "Images missing alternative text", `${missingAlt} image(s) have no alt attribute. Decorative images may correctly use an empty alt attribute.`, "Add descriptive alternatives for meaningful images; review decorative images separately.");
    if (!meta("viewport").toArray().some(node => /width\s*=\s*device-width/i.test($(node).attr("content") ?? ""))) add("viewport", "info", "Mobile viewport not declared", "No device-width viewport declaration found in the returned HTML; layout was not rendered.", "Review the mobile layout and add an appropriate viewport declaration.");
    if (new URL(page.finalUrl).protocol !== "https:") add("http-not-https", "warning", "Page served over HTTP", "The final inspected URL does not use HTTPS.", "Serve the page over HTTPS with a valid certificate and redirect HTTP traffic.");
  }
  if (page.redirectCount > 1) add("redirect-chain", "info", "Redirect chain", `Observed ${page.redirectCount} redirect hops.`, "Link directly to the final URL when practical.");
  return { page, issues, followLinks };
}
export function analyzeCrawlPages(pages: CrawlPage[]): SeoIssue[] {
  const issues: SeoIssue[] = []; const fetched = new Map(pages.flatMap(p => [[p.url, p], [p.finalUrl, p]] as const));
  for (const key of ["title", "description"] as const) {
    const groups = new Map<string, CrawlPage[]>(); for (const p of pages.filter(p => p.status >= 200 && p.status < 300 && !p.error)) { const value = p[key].trim().toLowerCase(); if (value) groups.set(value, [...(groups.get(value) ?? []), p]); }
    for (const group of groups.values()) if (new Set(group.map(p => p.finalUrl)).size > 1) for (const p of group) issues.push(issue(p.url, `duplicate-${key}`, "warning", `Duplicate ${key}`, `Shared by ${group.length} fetched pages.`, "Review whether these pages need distinct metadata or consolidation."));
  }
  for (const p of pages) {
    const broken = p.internalLinks.filter(link => (fetched.get(link)?.status ?? 0) >= 400);
    if (broken.length) issues.push(issue(p.url, "broken-internal-link", "warning", "Broken internal links", `Actually fetched error destinations: ${broken.slice(0, 10).join(", ")}`, "Update or restore the linked destinations."));
    const canonical = fetched.get(p.canonical);
    if (canonical && (canonical.status >= 400 || canonical.noindex)) issues.push(issue(p.url, "canonical-unindexable", "warning", "Canonical target has an indexing blocker", `Fetched canonical returned ${canonical.status}${canonical.noindex ? " and noindex" : ""}.`, "Review the preferred destination and its indexing directives."));
    else if (canonical?.canonical && canonical.canonical !== p.canonical) issues.push(issue(p.url, "canonical-chain", "info", "Canonical target points elsewhere", `Fetched target declares ${canonical.canonical}.`, "Review whether these canonical declarations agree."));
  }
  return issues;
}

export interface CrawlDependencies extends Pick<FetchDependencies, "resolve" | "transport"> { now?: () => number; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal }
export async function runCrawl(input: string, options: { maxPages?: number } = {}, dependencies: CrawlDependencies = {}): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? 25; if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error("maxPages must be an integer from 1 to 100.");
  const siteUrl = normalizeWebsiteUrl(input), initial = new URL(siteUrl); let origin = initial.origin;
  const now = dependencies.now ?? Date.now, sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const start = now(); const controller = new AbortController(); const cancel = () => controller.abort(); dependencies.signal?.addEventListener("abort", cancel, { once: true }); if (dependencies.signal?.aborted) cancel();
  const timer = setTimeout(cancel, 120000); const limitations = new Set<string>(["Static HTML only; JavaScript, rankings, and indexing in search engines are not measured. Unfetched URLs have unknown status.", "Score: 100 minus per-page penalties (critical 30, warning 8, info 2; floor 0), averaged across inspected HTML pages. Unknown/non-HTML pages are excluded. It is a diagnostic heuristic, not a ranking prediction.", "Discovered query-string URLs, non-HTML pages, compressed sitemaps, external hosts, and nofollow links are excluded; coverage is bounded."]);
  const pages: CrawlPage[] = [], issues: SeoIssue[] = []; let requests = 0, sitemapCount = 0;
  const requestCap = maxPages * 4 + 28; const policies = new Map<string, RobotsPolicy>(); const unavailablePolicies = new Set<string>(); const last = new Map<string, number>();
  const check = () => { if (controller.signal.aborted || now() - start >= 120000) throw new Error("Crawl cancelled or elapsed time limit reached; results are partial."); if (requests >= requestCap) throw new Error("Request cap reached; results are partial."); };
  const throttle = async (url: URL, delay = 250) => {
    check(); const wait = Math.max(0, (last.get(url.hostname) ?? -Infinity) + delay - now());
    if (wait) {
      let onAbort: () => void = () => {};
      const interrupted = new Promise<never>((_, reject) => { onAbort = () => reject(new Error("Crawl cancelled or elapsed time limit reached; results are partial.")); controller.signal.addEventListener("abort", onAbort, { once: true }); });
      try { await Promise.race([sleep(wait), interrupted]); } finally { controller.signal.removeEventListener("abort", onAbort); }
    }
    check(); last.set(url.hostname, now()); requests++;
  };
  const policy = async (targetOrigin: string): Promise<RobotsPolicy> => {
    const cached = policies.get(targetOrigin); if (cached) return cached;
    if (policies.size >= 3) throw new Error("Robots origin limit reached.");
    const blocked: RobotsPolicy = { rules: [{ pattern: "/", allow: false }], sitemaps: [], delayMs: 250 }; policies.set(targetOrigin, blocked);
    try {
      const sourceHost = new URL(targetOrigin).hostname.replace(/^www\./, "");
      const response = await safeFetch(`${targetOrigin}/robots.txt`, { ...dependencies, signal: controller.signal, validate: async url => { if (url.hostname.replace(/^www\./, "") !== sourceHost) throw new Error("Unrelated-host robots redirect refused."); await throttle(url); } });
      if (response.status !== 404 && (response.status < 200 || response.status >= 300)) throw new Error(`HTTP ${response.status}`);
      if (response.status !== 404 && /text\/html/i.test(response.headers["content-type"] ?? "")) throw new Error("HTML instead of robots policy");
      const parsed = parseRobots(response.status === 404 ? "" : response.body);
      if (parsed.delayMs > 10000) throw new Error("Crawl-delay exceeds the supported 10-second bound");
      policies.set(targetOrigin, parsed); return parsed;
    } catch (error) { unavailablePolicies.add(targetOrigin); limitations.add(`Robots policy unavailable for ${targetOrigin}; failed closed (${error instanceof Error ? error.message : "network error"}).`); return blocked; }
  };
  const fetchResource = async (url: string, root = false) => safeFetch(url, { ...dependencies, signal: controller.signal,
    redirect: (from, to) => { const wwwPair = from.hostname.replace(/^www\./, "") === to.hostname.replace(/^www\./, "") && from.hostname !== to.hostname;
      if (to.origin !== origin && !(root && from.pathname === "/" && (wwwPair || from.hostname === to.hostname))) throw new Error("Out-of-origin redirect refused.");
    },
    validate: async target => { const p = await policy(target.origin); check(); if (!robotsAllows(p, target.href)) throw new Error(unavailablePolicies.has(target.origin) ? "Robots policy unavailable; fetching refused." : "Disallowed by robots.txt for SEOCommandCenter/EDOrbit."); await throttle(target, p.delayMs); },
  });
  const queue = [siteUrl], queued = new Set(queue), seen = new Set<string>();
  const enqueue = (value: string) => { try { const u = new URL(value, origin); u.hash = ""; if (u.origin !== origin || u.search || queued.size >= maxPages * 10 || queued.has(u.href)) return; queued.add(u.href); queue.push(u.href); } catch { /* invalid */ } };
  const sitemap = async (url: string, depth: number): Promise<void> => {
    if (sitemapCount >= 5 || depth > 2) { limitations.add("Sitemap fetch/depth limit reached; sitemap coverage is partial."); return; }
    let target: URL; try { target = new URL(url, origin); } catch { return; } if (target.origin !== origin || target.search) return;
    if (/\.gz$/i.test(target.pathname)) { limitations.add("Gzip sitemap was not read."); return; }
    sitemapCount++;
    try { const r = await fetchResource(target.href); if (r.status !== 200) { limitations.add(`Sitemap ${target.href} returned HTTP ${r.status}.`); return; }
      if (/<!DOCTYPE|<!ENTITY/i.test(r.body)) throw new Error("XML declarations with entities are unsupported");
      const $ = load(r.body, { xmlMode: true }); if ($("sitemapindex").length) { for (const el of $("sitemap > loc").toArray()) await sitemap($(el).text().trim(), depth + 1); }
      else if ($("urlset").length) $("url > loc").each((_, el) => { enqueue($(el).text().trim()); });
      else limitations.add(`Sitemap ${target.href} did not contain supported sitemap XML.`);
    } catch (error) { limitations.add(`Sitemap not read: ${error instanceof Error ? error.message : "network failure"}.`); }
  };
  try {
    while (queue.length && pages.length < maxPages) {
      check(); const url = queue.shift()!; if (seen.has(url)) continue; seen.add(url);
      try {
        const response = await fetchResource(url, pages.length === 0 && initial.pathname === "/");
        if (!pages.length) origin = new URL(response.url).origin;
        seen.add(response.url);
        if (!/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers["content-type"] ?? "")) {
          pages.push({ url, finalUrl: response.url, status: response.status, title: "", description: "", canonical: "", h1Count: 0, noindex: false, internalLinks: [], redirectCount: response.redirects?.length ?? 0, error: "Not supported HTML" }); limitations.add(`Non-HTML content at ${url} was not analyzed.`);
          if (response.status >= 400) issues.push(issue(url, "http-error", "critical", "HTTP error", `Fetched HTTP ${response.status}; body was not HTML.`, "Restore the page or update links to its replacement."));
        } else { const result = analyzeCrawlPage(response, url); pages.push(result.page); issues.push(...result.issues); if (result.followLinks) result.page.internalLinks.forEach(enqueue); }
        if (pages.length === 1) { const p = await policy(origin); for (const map of [...new Set([...p.sitemaps, `${origin}/sitemap.xml`])]) await sitemap(map, 0); }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Fetch failed"; limitations.add(`${url}: ${message}`);
        pages.push({ url, finalUrl: url, status: 0, title: "", description: "", canonical: "", h1Count: 0, noindex: false, internalLinks: [], redirectCount: 0, error: message });
        issues.push(message.startsWith("Disallowed by robots.txt")
          ? issue(url, "robots-disallowed", "critical", "Crawler blocked by robots.txt", message, "Review the matching rule if this page should be crawled. Other user agents may have different rules; indexing status is unknown.")
          : issue(url, "unfetched", "info", "Page could not be inspected", message, "Review robots, network accessibility, and crawl limits. HTTP status is unknown."));
      }
    }
    if (queue.length) limitations.add(`Page cap (${maxPages}) reached with ${queue.length} queued URLs; this is a partial crawl.`);
  } catch (error) { limitations.add(error instanceof Error ? error.message : "Crawl stopped early."); }
  finally { clearTimeout(timer); controller.abort(); dependencies.signal?.removeEventListener("abort", cancel); }
  issues.push(...analyzeCrawlPages(pages));
  const weights = { critical: 30, warning: 8, info: 2 }; const inspected = pages.filter(p => p.status > 0 && !p.error);
  const score = inspected.length ? Math.round(inspected.reduce((sum, p) => sum + Math.max(0, 100 - issues.filter(i => i.url === p.url).reduce((n, i) => n + weights[i.severity], 0)), 0) / inspected.length) : 0;
  if (!inspected.length) limitations.add("No HTML page was inspected; score 0 represents unavailable assessment, not measured SEO quality.");
  return { id: randomUUID(), siteUrl, startedAt: new Date(start).toISOString(), completedAt: new Date(now()).toISOString(), score, pages, issues, limitations: [...limitations], requests };
}
