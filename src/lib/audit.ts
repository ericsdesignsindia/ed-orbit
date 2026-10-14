import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { normalizeWebsiteUrl } from "./site-url";
import { safeFetch, type SafeResponse } from "./safe-fetch";

export interface AuditCheck { id: string; title: string; status: 'pass' | 'warning' | 'fail' | 'info'; detail: string; recommendation?: string }
export interface AuditResult { id: string; domain: string; url: string; scannedAt: string; score: number; checks: AuditCheck[]; pagesChecked: number; durationMs: number }

/** Pure static HTML analysis. Does not execute JavaScript or infer search rankings. */
export function analyzeHomepage(html: string, url: string, headers: Record<string, string> = {}): AuditCheck[] {
  const $ = load(html);
  const checks: AuditCheck[] = [];
  const add = (id: string, title: string, ok: boolean, detail: string, recommendation: string) => checks.push({ id, title, status: ok ? "pass" : "warning", detail, ...(!ok ? { recommendation } : {}) });
  const titles = $("head title"); const title = titles.first().text().trim();
  add("title", "Page title", titles.length === 1 && !!title, title ? `Found ${titles.length} title element(s); first title is ${title.length} characters: ${title.slice(0, 200)}` : "No nonempty page title found in the returned HTML.", "Use one descriptive title. There is no absolute character-count ranking rule; display width varies.");
  const meta = (name: string) => $("meta").filter((_, node) => ($(node).attr("name") ?? "").toLowerCase() === name);
  const descriptions = meta("description"); const description = descriptions.first().attr("content")?.trim() ?? "";
  add("description", "Meta description", descriptions.length === 1 && !!description, `Found ${descriptions.length} description tag(s); first description is ${description.length} characters.`, "Add one helpful description. Search engines may rewrite or truncate it; length is not an absolute SEO rule.");
  const canonical = $("link").filter((_, node) => ($(node).attr("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const href = canonical.first().attr("href")?.trim(); let validCanonical = false;
  try { validCanonical = !!href && ["http:", "https:"].includes(new URL(href!, url).protocol); } catch { /* Invalid markup is a warning. */ }
  add("canonical", "Canonical URL", canonical.length === 1 && validCanonical, href ? `Canonical declaration: ${href.slice(0, 300)}. Destination was not fetched.` : "No canonical URL declaration found.", "Declare one valid canonical URL for the preferred version of this page.");
  const h1 = $("h1");
  add("h1", "Primary heading", h1.toArray().some(node => !!$(node).text().trim()), `Found ${h1.length} H1 element(s).`, "Provide a clear primary heading and logical heading structure. Multiple H1 elements are not automatically an SEO error.");
  const images = $("img"); const missing = images.filter((_, node) => $(node).attr("alt") === undefined).length;
  checks.push({ id: "image-alt", title: "Image alternative text", status: images.length ? (missing ? "warning" : "pass") : "info", detail: `${images.length} image(s); ${missing} missing an alt attribute. Empty alt attributes may be appropriate for decorative images; text quality was not assessed.`, ...(missing ? { recommendation: "Add descriptive alt text for meaningful images and empty alt text for decorative images." } : {}) });
  const directives = [...meta("robots").toArray(), ...meta("googlebot").toArray()].map((node) => $(node).attr("content") ?? "").join(",") + "," + (headers["x-robots-tag"] ?? "");
  const noindex = /(?:^|[\s,:])(?:noindex|none)(?:$|[\s,;])/i.test(directives);
  checks.push({ id: "indexability", title: "Indexing directives", status: noindex ? "fail" : "pass", detail: noindex ? "A noindex/none directive was detected in robots metadata or the X-Robots-Tag header." : "No noindex directive detected in static robots metadata or response headers. This does not prove crawlability or search-engine indexing.", ...(noindex ? { recommendation: "Remove noindex only if this page is intended to appear in search results." } : {}) });
  add("viewport", "Mobile viewport", meta("viewport").toArray().some((node) => /width\s*=\s*device-width/i.test($(node).attr("content") ?? "")), "Checked static HTML for a device-width viewport declaration; mobile layout was not rendered.", "Include a viewport meta tag with width=device-width and verify the mobile layout.");
  add("https", "HTTPS", new URL(url).protocol === "https:", `Final homepage uses ${new URL(url).protocol === "https:" ? "HTTPS" : "HTTP"}.`, "Serve the homepage over HTTPS and avoid redirects to HTTP.");
  return checks;
}

type AuditFetch = (url: string) => Promise<SafeResponse>;
async function resourceCheck(fetcher: AuditFetch, origin: string, filename: string): Promise<AuditCheck> {
  const base = { id: filename === "robots.txt" ? "robots" : "sitemap", title: filename === "robots.txt" ? "robots.txt reachability" : "Default sitemap reachability" };
  try {
    const response = await fetcher(`${origin}/${filename}`);
    if (response.status === 404 || response.status === 410) return { ...base, status: "warning", detail: `${filename} returned HTTP ${response.status}. Other sitemap locations were not checked.`, recommendation: `Review whether a ${filename} file should be published at this location.` };
    if (response.status < 200 || response.status >= 300) return { ...base, status: "info", detail: `${filename} returned HTTP ${response.status}; availability could not be established.` };
    const looksCorrect = filename === "robots.txt" ? /^(?:user-agent|sitemap)\s*:/im.test(response.body) : /<(?:\w+:)?(?:urlset|sitemapindex)(?:\s|>)/i.test(response.body);
    return { ...base, status: looksCorrect ? "pass" : "warning", detail: looksCorrect ? `${filename} is reachable and contains recognizable ${filename === "robots.txt" ? "robots directives" : "sitemap markup"}. Contents and URL coverage were not comprehensively validated.` : `${filename} returned success but did not contain recognizable expected content.`, ...(!looksCorrect ? { recommendation: "Verify that this endpoint returns the intended resource rather than a fallback HTML page." } : {}) };
  } catch { return { ...base, status: "info", detail: `${filename} could not be checked due to a network, timeout, or safety restriction. Its presence is unknown.` }; }
}

/** Exactly three resource fetches (homepage, robots.txt, sitemap.xml), plus bounded redirects. */
export async function runAudit(domain: string, fetcher: AuditFetch = safeFetch): Promise<AuditResult> {
  const target = normalizeWebsiteUrl(domain); const normalized = new URL(target).hostname; const started = Date.now();
  let homepage: SafeResponse;
  try { homepage = await fetcher(target); }
  catch { throw new Error("The homepage could not be retrieved safely. Check the public domain and try again."); }
  if (homepage.status < 200 || homepage.status >= 300) throw new Error(`The homepage returned HTTP ${homepage.status}; no audit was completed.`);
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(homepage.headers["content-type"] ?? "")) throw new Error("The homepage did not return a supported HTML content type; no audit was completed.");
  const origin = new URL(homepage.url).origin;
  const checks = analyzeHomepage(homepage.body, homepage.url, homepage.headers);
  checks.push(...await Promise.all([resourceCheck(fetcher, origin, "robots.txt"), resourceCheck(fetcher, origin, "sitemap.xml")]));
  checks.push({ id: "scope", title: "Limited homepage audit", status: "info", detail: "One homepage's server-returned HTML plus robots.txt and /sitemap.xml reachability only. No site crawl, JavaScript rendering, performance measurements, backlink analysis, ranking data, or complete indexing validation. Score is an equal-weight checklist heuristic; unknown checks are excluded." });
  const scored = checks.filter((check) => check.status !== "info");
  const score = Math.round(scored.reduce((total, check) => total + (check.status === "pass" ? 1 : check.status === "warning" ? 0.5 : 0), 0) / Math.max(scored.length, 1) * 100);
  return { id: randomUUID(), domain: normalized, url: homepage.url, scannedAt: new Date().toISOString(), score, checks, pagesChecked: 1, durationMs: Date.now() - started };
}
