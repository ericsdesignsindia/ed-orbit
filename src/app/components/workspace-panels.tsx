"use client";

import { useState } from "react";
import type { AppSnapshot, SavedCrawl, SavedReport, ScheduleRecord, SiteRecord, WorkspaceAction, JobRecord, JobKind } from "@/lib/contracts";
import type { SearchInsight } from "@/lib/google";

export const when = (value?: string) => value ? new Date(value).toLocaleString() : "Not yet";
const number = (value?: number | null) => value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const percent = (value?: number | null) => value == null ? "No comparison baseline" : `${value > 0 ? "+" : ""}${number(value)}%`;
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), cache: "no-store", signal: AbortSignal.timeout(url.includes("google") || url.includes("pagespeed") ? 180000 : 45000) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The server request failed. Please try again.");
  return data as T;
}
export function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(name: string, rows: unknown[][]) {
  const cell = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; };
  download(name, "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}

export function IssuePanel({ crawl }: { crawl?: SavedCrawl }) {
  const [severity, setSeverity] = useState("all"), [change, setChange] = useState("active"), [url, setUrl] = useState("");
  if (!crawl) return <section className="card live-panel"><h2>Start with evidence</h2><p className="body-copy">No crawl is saved for this website. Choose a page budget and approve an audit to see prioritized findings.</p></section>;
  const rank = { critical: 0, warning: 1, info: 2 };
  const issues = crawl.issues.filter(i => {
    const lifecycleMatches = change === "all" || (change === "active" ? i.change !== "resolved" : (i.change ?? "new") === change);
    return (severity === "all" || i.severity === severity) && lifecycleMatches && i.url.toLowerCase().includes(url.toLowerCase());
  }).sort((a,b) => rank[a.severity] - rank[b.severity]);
  return <section className="card live-panel"><div className="live-panel-heading"><div><h2>Fix the highest-impact issues first</h2><p>{crawl.pages.filter(page => page.status > 0 && !page.error).length} pages inspected from {crawl.pages.length} page records · {crawl.requests} requests · completed {when(crawl.completedAt)}</p></div><button className="button secondary no-print" onClick={() => csv("seo-command-center-issues.csv", [["Severity", "Change", "Title", "Page URL", "Evidence", "Recommendation"], ...issues.map(i => [i.severity, i.change ?? "new", i.title, i.url, i.detail, i.recommendation])])}>Export filtered issues CSV</button></div>
    <div className="live-stat-strip">{(["critical", "warning", "info"] as const).map(s => <span key={s}>{s}<strong>{crawl.issues.filter(i => i.severity === s && i.change !== "resolved").length}</strong></span>)}{["new", "ongoing", "not-rechecked", "resolved"].map(c => <span key={c}>{c.replaceAll("-", " ")}<strong>{crawl.issues.filter(i => (i.change ?? "new") === c).length}</strong></span>)}</div>
    {!crawl.pages.some(page => page.status > 0 && !page.error) && <p className="audit-scope">Score unavailable: this crawl has no successfully inspected HTML page records. A completed request does not establish scan quality.</p>}
    {crawl.issues.some(i => i.change === "not-rechecked") && <p className="audit-scope">Not rechecked means a previously reported issue was not inspected in this partial crawl. It remains unresolved; omission is not evidence of a fix. Active totals include these findings.</p>}
    <div className="inline-actions issue-filters no-print"><label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}>{["all", "critical", "warning", "info"].map(v => <option key={v}>{v}</option>)}</select></label><label>Lifecycle<select value={change} onChange={e => setChange(e.target.value)}>{["active", "all", "new", "ongoing", "not-rechecked", "resolved"].map(v => <option key={v} value={v}>{v.replaceAll("-", " ")}</option>)}</select></label><label>Page URL<input type="search" value={url} onChange={e => setUrl(e.target.value)} placeholder="Filter by URL"/></label></div>
    {!issues.length && <p className="body-copy">No findings match these filters. This does not establish that uncrawled pages are issue-free.</p>}
    {issues.map(i => <article className="check-row" key={i.id}><span className={`check-status ${i.severity === "critical" ? "fail" : i.severity}`}>{i.severity}</span><div><h3>{i.title} <span className="badge neutral">{(i.change ?? "new").replaceAll("-", " ")}</span></h3><p className="issue-url">{i.url}</p><p>{i.detail}</p><p className="recommendation"><strong>Next step:</strong> {i.recommendation}</p></div></article>)}
    <details><summary>Crawl scope & limitations</summary><ul className="scope-list">{crawl.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul><p className="body-copy">Static, bounded public-site crawl. Observed findings do not cover every page, rendered JavaScript, or Google’s ranking systems.</p></details>
  </section>;
}

export function ReportPanel({ report, error }: { report?: SavedReport; error?: string }) {
  const data = report?.data;
  return <section className="card live-panel"><div className="live-panel-heading"><div><h2>Organic performance</h2><p>{report ? `${data?.startDate} to ${data?.endDate} · last saved ${when(report.fetchedAt)}` : "No saved Google report. Connect Search Console or GA4 and load a report."}</p></div></div>
    {error && <div className="notice error-notice" role="alert">Latest refresh failed or was incomplete: {error}. {report ? `Showing the last saved data from ${when(report.fetchedAt)}; it may be stale.` : "No valid report is available yet."}</div>}
    {data?.errors?.map(e => <p className="form-error" key={e}>{e}</p>)}
    {data?.properties && <p className="body-copy">Saved report sources: Search Console {data.properties.siteUrl || "not selected"} · GA4 {data.properties.propertyId || "not selected"}. Changing website bindings does not rewrite historical reports.</p>}
    {!!data?.limitations?.length && <details><summary>Reporting scope & limitations</summary><ul className="scope-list">{data.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {data && <><div className="source-status"><span>Search Console: {data.gsc ? "Data returned" : "No data source returned"}</span><span>GA4: {data.ga4 ? "Data returned" : "No data source returned"}</span></div><div className="kpi-grid">{[["Organic clicks", number(data.gsc?.clicks), percent(data.comparison?.changes.clicksPercent)], ["Search impressions", number(data.gsc?.impressions), percent(data.comparison?.changes.impressionsPercent)], ["Search CTR", data.gsc ? `${number(data.gsc.ctr * 100)}%` : "—", data.comparison ? `Previous: ${number(data.comparison.previous.ctr * 100)}%` : "Search Console"], ["Average search position", data.gsc?.impressions ? number(data.gsc.position) : "—", data.comparison ? `Previous: ${number(data.comparison.previous.position)}` : "Impression-weighted"]].map(([label, value, detail]) => <article className="kpi" key={label}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><small>{detail}</small></article>)}</div>
      {data.comparison && <p className="body-copy">Compared with {data.comparison.startDate} to {data.comparison.endDate}: {number(data.comparison.previous.clicks)} clicks and {number(data.comparison.previous.impressions)} impressions.</p>}
      {data.ga4 && <><h3>{data.ga4.trafficScope === "organic-search" ? "GA4 · Organic Search channel" : "GA4 · saved report (scope not specified)"}</h3><div className="live-stat-strip"><span>Users <strong>{number(data.ga4.users)}</strong></span><span>Sessions <strong>{number(data.ga4.sessions)}</strong></span><span>Page views <strong>{number(data.ga4.pageViews)}</strong></span><span>Key events <strong>{number(data.ga4.keyEvents)}</strong></span></div></>}
      <InsightTable title="Search queries" rows={data.queries}/><InsightTable title="Search pages" rows={data.pages}/>
      {!!data.opportunities?.length && <><h3>Search opportunities</h3>{data.opportunities.map(o => <article className="check-row" key={o.id}><span className="badge neutral">{o.type}</span><div><h3>{o.title}</h3><p>{o.detail}</p>{o.url && <p>{o.url}</p>}</div></article>)}</>}
      {!!data.gsc?.rows.length && <details><summary>Daily Search Console values</summary><div className="table-scroll"><table><thead><tr><th>Date</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>{data.gsc.rows.map(row => <tr key={row.date}><td>{row.date}</td><td>{number(row.clicks)}</td><td>{number(row.impressions)}</td></tr>)}</tbody></table></div></details>}
    </>}
  </section>;
}
function InsightTable({ title, rows }: { title: string; rows?: SearchInsight[] }) {
  const omitted = rows?.some(r => r.currentObserved === false || r.previousObserved === false);
  const current = (r: SearchInsight, value: number) => r.currentObserved === false ? "Not returned" : value;
  const previous = (r: SearchInsight) => r.previousObserved === false ? "Not returned" : r.previousClicks;
  const comparable = (r: SearchInsight) => r.currentObserved !== false && r.previousObserved !== false;
  return <div className="insight-table">
    <div className="live-panel-heading"><h3>{title}</h3>{!!rows?.length && <button className="button secondary no-print" onClick={() => csv(`seo-command-center-${title.toLowerCase().replaceAll(" ", "-")}.csv`, [["Query / page", "Clicks", "Impressions", "CTR", "Position", "Previous clicks", "Click change %"], ...rows.map(r => [r.key, current(r, r.clicks), current(r, r.impressions), current(r, r.ctr), current(r, r.position), previous(r), comparable(r) ? r.clickChangePercent ?? "No comparison baseline" : "Not returned"])])}>Export CSV</button>}</div>
    {omitted && <p className="audit-scope">“Not returned” means the row was omitted from that period’s top 1,000 results, not that its traffic was zero. Changes cannot be calculated when either period is missing.</p>}
    {rows?.length ? <div className="table-scroll" tabIndex={0} aria-label={`${title} scrollable table`}><table><thead><tr><th scope="col">Query / page</th><th scope="col">Clicks</th><th scope="col">Impressions</th><th scope="col">CTR</th><th scope="col">Position</th><th scope="col">Previous clicks</th><th scope="col">Click change</th></tr></thead><tbody>{rows.map(r => <tr key={r.key}><th scope="row">{r.key}</th><td>{r.currentObserved === false ? "Not returned" : number(r.clicks)}</td><td>{r.currentObserved === false ? "Not returned" : number(r.impressions)}</td><td>{r.currentObserved === false ? "Not returned" : `${number(r.ctr * 100)}%`}</td><td>{r.currentObserved === false ? "Not returned" : number(r.position)}</td><td>{r.previousObserved === false ? "Not returned" : number(r.previousClicks)}</td><td>{comparable(r) ? percent(r.clickChangePercent) : "Not returned"}</td></tr>)}</tbody></table></div> : <p className="body-copy">No {title.toLowerCase()} returned in this saved report. Search Console may omit low-volume or anonymized rows.</p>}
  </div>;
}

export function JobsPanel({ jobs }: { jobs: JobRecord[] }) {
  return <section className="card live-panel"><h2>Execution history</h2><p className="body-copy">Queued and running jobs refresh every 3 seconds. Completed counts are reported only when available.</p>{!jobs.length && <p className="body-copy">No workflows have run for this website yet.</p>}{[...jobs].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(j => <article className="check-row" key={j.id}><span className={`check-status ${j.status === "failed" ? "fail" : j.status === "success" ? "pass" : "info"}`}>{j.status}</span><div><h3>{j.kind}</h3><p>{j.summary || (j.status === "running" ? "Work is running. No measured progress count is available yet." : "Waiting for execution.")}</p>{j.error && <p className="form-error">{j.error}</p>}<small>Created {when(j.createdAt)} · attempt {j.attempt} · {j.scheduleId ? "Scheduled" : "Manual"}{j.completedAt ? ` · completed ${when(j.completedAt)}` : ""}</small></div></article>)}</section>;
}

export function AutomationPanel({ site, schedules, busy, mutate, onError, hosted = false }: { site: SiteRecord; schedules: ScheduleRecord[]; busy: boolean; mutate: (a: WorkspaceAction) => Promise<AppSnapshot>; onError: (e: string) => void; hosted?: boolean }) {
  const [cadence, setCadence] = useState("daily"), [kind, setKind] = useState<JobKind>("audit");
  const run = (action: WorkspaceAction) => { onError(""); return mutate(action).catch(e => { onError(e instanceof Error ? e.message : "Could not save schedule."); return null; }); };
  return <><div className="info-banner"><ZapLabel/><div><strong>{hosted ? "Scheduled work is checked once a day." : "Scheduled work runs on this server."}</strong><p>{hosted ? "This Vercel plan checks schedules once per day, and the exact run time can vary. Schedules use the selected timezone; a workflow may run later than its selected time." : "Keep the SEO Command Center server running. Schedules use the selected timezone."} In-app notifications are always available; email requires optional SMTP configuration.</p></div></div><section className="card live-panel"><h2>Create a recurring workflow</h2><form className="schedule-form" onSubmit={e => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    if (kind === "audit" && !window.confirm(`Authorize recurring public-site crawls of ${site.url}?`)) return;
    void run({ action: "save-schedule", schedule: { websiteId: site.id, kind, enabled: true, cadence: cadence as "daily" | "weekly", time: String(data.get("time")), timezone: String(data.get("timezone")), weekday: Number(data.get("weekday") ?? 1), maxPages: Number(data.get("maxPages")), days: Number(data.get("days")) as 7 | 30 | 90, dropPercent: Number(data.get("dropPercent")), minClicks: Number(data.get("minClicks")), ...(String(data.get("email")).trim() ? { notificationEmail: String(data.get("email")).trim() } : {}) } });
  }}><div className="form-grid">
    <label>Workflow<select value={kind} onChange={e => setKind(e.target.value as JobKind)}><option value="audit">SEO crawl</option><option value="report">Google report</option><option value="traffic-alert">Organic traffic-drop alert</option></select></label>
    <label>Frequency<select value={cadence} onChange={e => setCadence(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
    <label>Local time<input name="time" type="time" defaultValue="09:00" required/></label>
    <label>IANA timezone<input name="timezone" defaultValue="Asia/Kolkata" placeholder="Asia/Kolkata" required/></label>
    {cadence === "weekly" && <label>Weekday<select name="weekday" defaultValue="1">{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d,i) => <option key={d} value={i}>{d}</option>)}</select></label>}
    <label>Crawl page budget<select name="maxPages" defaultValue="25">{[25,50,100].map(n => <option key={n}>{n}</option>)}</select></label>
    <label>Report period<select name="days" defaultValue="30">{[7,30,90].map(n => <option key={n} value={n}>{n} days</option>)}</select></label>
    <label>Alert drop threshold (%)<input type="number" name="dropPercent" min="1" max="100" defaultValue="30" required/></label>
    <label>Minimum previous-period clicks<input type="number" name="minClicks" min="0" max="100000000" defaultValue="100" required/></label>
    <label>Notification email (optional)<input type="email" name="email" placeholder="you@example.com" maxLength={254}/></label>
  </div><button className="button primary" disabled={busy || site.archived}>Save schedule</button></form></section>
  <section className="card live-panel"><h2>Saved schedules</h2>{!schedules.length && <p className="body-copy">No recurring workflows yet.</p>}{schedules.map(s => <article className="check-row" key={s.id}><span className="badge neutral">{s.enabled ? "Enabled" : "Paused"}</span><div><h3>{s.kind} · {s.cadence} at {s.time} ({s.timezone})</h3><p>{s.cadence === "weekly" ? `Weekday: ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.weekday]}. ` : ""}Next: {s.enabled ? when(s.nextRunAt) : "Paused"} · last: {when(s.lastRunAt)}</p><p>Budget {s.maxPages} pages · {s.days}-day reporting · alert at {s.dropPercent}% drop with at least {s.minClicks} previous clicks.</p><p>Email: {s.notificationEmail ?? "In-app only"}</p><div className="inline-actions"><button className="button secondary" disabled={busy} onClick={() => void run({ action: "save-schedule", schedule: { id: s.id, websiteId: s.websiteId, kind: s.kind, enabled: !s.enabled, cadence: s.cadence, time: s.time, timezone: s.timezone, weekday: s.weekday, maxPages: s.maxPages, days: s.days, dropPercent: s.dropPercent, minClicks: s.minClicks, notificationEmail: s.notificationEmail } })}>{s.enabled ? "Pause" : "Resume"}</button><button className="button danger" disabled={busy} onClick={() => { if (window.confirm("Delete this schedule? Existing execution history remains.")) void run({ action: "delete-schedule", id: s.id }); }}>Delete</button></div></div></article>)}</section></>;
}
function ZapLabel() { return <span aria-hidden="true">↻</span>; }

type PageSpeed = { url: string; strategy: string; fetchedAt: string; performanceScore: number | null; metrics: { name: string; value: string | number }[]; fieldDataAvailable: boolean; warning?: string };
export function PageSpeedPanel({ url }: { url: string }) {
  const [strategy, setStrategy] = useState("mobile"), [busy, setBusy] = useState(false), [result, setResult] = useState<PageSpeed | null>(null), [error, setError] = useState("");
  const current = result?.url === url ? result : null;
  return <section className="card live-panel"><h2>Optional PageSpeed check</h2><p className="body-copy">A separate Lighthouse lab measurement. It does not change your technical SEO score. Field data is shown only when available.</p><div className="inline-actions"><label>Device<select value={strategy} onChange={e => setStrategy(e.target.value)}><option value="mobile">Mobile</option><option value="desktop">Desktop</option></select></label><button className="button secondary" disabled={busy} onClick={() => { setBusy(true); setError(""); void api<PageSpeed>("/api/pagespeed", { url, strategy }).then(setResult).catch(e => setError(e instanceof Error ? e.message : "PageSpeed request failed.")).finally(() => setBusy(false)); }}>{busy ? "Measuring…" : "Run PageSpeed"}</button></div>{error && <p className="form-error" role="alert">{error}</p>}{current && <><p className="body-copy">{current.url} · {current.strategy} · fetched {when(current.fetchedAt)}</p><p>Lab performance: <strong>{current.performanceScore == null ? "Unavailable" : `${current.performanceScore} / 100`}</strong> · Field data: {current.fieldDataAvailable ? "Available" : "Unavailable"}</p>{current.warning && <p className="audit-scope">{current.warning}</p>}<dl className="speed-metrics">{current.metrics.map(m => <div key={m.name}><dt>{m.name}</dt><dd>{m.value}</dd></div>)}</dl></>}</section>;
}
