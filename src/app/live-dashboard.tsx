"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Globe2, LayoutDashboard, Link2, LoaderCircle, Menu, Plus, Settings2, Target, X, Zap } from "lucide-react";
import type { AppSnapshot, WorkspaceAction, JobKind } from "@/lib/contracts";
import type { GoogleReport, Properties } from "@/lib/google";
import { AutomationPanel, IssuePanel, ReportPanel, JobsPanel, PageSpeedPanel, download, api, when } from "./components/workspace-panels";
import { WordPressPanel } from "./components/wordpress-panel";
import { useWorkspacePreferences, WorkspaceControls } from "./workspace-controls";

type GoogleStatus = { configured: boolean; connected: boolean; missing: string[]; services?: { gsc: boolean; ga4: boolean }; retryable?: boolean; reconnectNeeded?: boolean };
const views = ["Overview", "Websites", "Opportunities", "Automations", "Integrations", "Notifications", "Settings"] as const;
type View = typeof views[number];
const icons = [LayoutDashboard, Globe2, Target, Zap, Link2, Activity, Settings2];
const message = (error: unknown) => error instanceof Error ? error.message : "Request failed. Please try again.";

export default function LiveDashboard({ hosted = false }: { hosted?: boolean }) {
  const { darkMode, autoRefresh, toggleDarkMode, toggleAutoRefresh } = useWorkspacePreferences();
  const [state, setState] = useState<AppSnapshot | null>(null);
  const [initialImportDone, setInitialImportDone] = useState(false);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<View>("Overview");
  const [mobile, setMobile] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [syncError, setSyncError] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(0);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [googleError, setGoogleError] = useState("");
  const [properties, setProperties] = useState<Properties | null>(null);
  const [propertyBusy, setPropertyBusy] = useState(false);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [budget, setBudget] = useState(25);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErrors, setReportErrors] = useState<Record<string, string>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const migrationChecked = useRef(false);
  const migrationFinished = useRef(false);
  const wasGoogleConnected = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const site = state?.sites.find(s => s.id === selected) ?? state?.sites.find(s => !s.archived) ?? state?.sites[0];
  const crawl = state?.crawls.filter(c => c.websiteId === site?.id).sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
  const inspectedPages = crawl?.pages.filter(page => page.status > 0 && !page.error).length ?? 0;
  const report = state?.reports.filter(r => r.websiteId === site?.id).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
  const activeJobs = !!state?.jobs.some(j => j.status === "running" || j.status === "queued");
  const accept = useCallback((next: AppSnapshot) => setState(previous => !previous || next.revision >= previous.revision ? next : previous), []);
  const mutate = useCallback((action: WorkspaceAction): Promise<AppSnapshot> => {
    if (action.action === "add-site" && !migrationFinished.current) return Promise.reject(new Error("Please wait for the initial browser import check to finish."));
    setBusy(n => n + 1);
    const request = queue.current.catch(() => undefined).then(() => api<AppSnapshot>("/api/workspace", action)).then(next => { accept(next); return next; });
    queue.current = request;
    return request.finally(() => setBusy(n => n - 1));
  }, [accept]);
  const act = (action: WorkspaceAction) => { setFailure(""); void mutate(action).catch(e => setFailure(message(e))); };
  const refresh = useCallback(async () => {
    try {
      const next = await api<AppSnapshot>("/api/workspace"); accept(next); setSyncError("");
      if (!migrationChecked.current) {
        migrationChecked.current = true;
        if (!next.migrationComplete && next.sites.length === 0 && next.crawls.length === 0 && next.reports.length === 0 && next.jobs.length === 0 && next.schedules.length === 0) {
          let raw: string | null = null;
          try { raw = localStorage.getItem("orbit.live-workspace.v1"); } catch { setNotice("Browser storage could not be read. The server workspace remains available."); }
          if (raw) {
            try { await mutate({ action: "import-legacy", raw }); setNotice("Browser workspace imported into durable server storage. Your original browser copy is unchanged."); }
            catch (e) { setRecovery(raw); setFailure(`Legacy import could not complete: ${message(e)} Download the original for recovery.`); }
          }
        }
        migrationFinished.current = true;
        setInitialImportDone(true);
      }
    } catch (e) { setSyncError(`Workspace sync failed: ${message(e)} Last loaded data is retained.`); }
  }, [accept, mutate]);
  const refreshGoogle = useCallback(async () => { try { setGoogle(await api<GoogleStatus>("/api/google/status")); setGoogleError(""); } catch (e) { setGoogleError(message(e)); } }, []);
  const loadProperties = useCallback(async () => {
    setPropertyBusy(true);
    try { setProperties(await api<Properties>("/api/google/properties")); setGoogleError(""); } catch (e) { setGoogleError(message(e)); } finally { setPropertyBusy(false); }
  }, []);
  useEffect(() => {
    try { setSelected(localStorage.getItem("orbit.selected-site") ?? ""); } catch { /* Preference is optional. */ }
    void refresh(); void refreshGoogle();
    const result = new URLSearchParams(window.location.search).get("google");
    if (result) { setView("Integrations"); if (result === "connected") setNotice("Google authorization completed. Confirm the matching properties below."); else setGoogleError("Google authorization did not complete. Try connecting the required source again."); window.history.replaceState({}, "", window.location.pathname); }
  }, [refresh, refreshGoogle]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void refresh(), activeJobs ? 3000 : 20000);
    return () => clearInterval(timer);
  }, [activeJobs, autoRefresh, refresh]);
  useEffect(() => { if (google?.connected && !google.retryable && !google.reconnectNeeded) void loadProperties(); }, [google?.connected, google?.retryable, google?.reconnectNeeded, loadProperties]);
  useEffect(() => {
    if (!google) return;
    if (wasGoogleConnected.current && !google.connected && !google.retryable) {
      setProperties(null);
      setNotice("Google is disconnected. Cached reports intentionally remain in your durable workspace; they contain reporting data, not connection credentials.");
    }
    wasGoogleConnected.current = google.connected;
  }, [google]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(false);
      if (e.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, select");
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handle); return () => { document.removeEventListener("keydown", handle); previous?.focus(); };
  }, [modal]);
  function select(id: string) { setSelected(id); try { localStorage.setItem("orbit.selected-site", id); } catch { /* Preference only. */ } }
  function navigate(next: View) { setView(next); setMobile(false); }
  function enqueue(kind: JobKind) { if (site) { act({ action: "enqueue", websiteId: site.id, kind, maxPages: budget, days }); setNotice("Job submission requested. Execution status appears below after the server accepts it."); } }
  async function loadReport() {
    if (!site) return;
    const target = site; setReportBusy(true);
    try {
      const data = await api<GoogleReport>("/api/google/report", { days, ...(target.bindings.siteUrl ? { siteUrl: target.bindings.siteUrl } : {}), ...(target.bindings.propertyId ? { propertyId: target.bindings.propertyId } : {}) });
      if (!data.gsc && !data.ga4) throw new Error(data.errors?.join(" ") || "No reporting source returned data.");
      await mutate({ action: "save-report", websiteId: target.id, days, data });
      setReportErrors(previous => ({ ...previous, [target.id]: data.errors?.join(" ") ?? "" })); setNotice("Google report saved to the server.");
    } catch (e) { setReportErrors(previous => ({ ...previous, [target.id]: message(e) })); } finally { setReportBusy(false); }
  }
  const suggested = properties?.gsc.filter(p => { try { const host = p.siteUrl.startsWith("sc-domain:") ? p.siteUrl.slice(10) : new URL(p.siteUrl).hostname; return site && (site.domain === host || (p.siteUrl.startsWith("sc-domain:") && site.domain.endsWith(`.${host}`))); } catch { return false; } });

  return <div className="app-shell live-app">
    {mobile && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? "is-open" : ""}`}><a className="brand seo-command-center-brand" href="/seo" aria-label="SEO Command Center home"><img className="brand-logo" src="/signal-home-logo.png" alt="Signal by Eric's Designs" /></a><div className="workspace-switch"><div className="workspace-avatar"><Globe2 size={18}/></div><div><strong>Your SEO workspace</strong><small>{hosted ? "Hosted · Neon database" : "Local · durable server storage"}</small></div></div><a className="workspace-shortcut" href="/">Open Signal social workspace <span aria-hidden="true">↗</span></a><div className="nav-label">WORKSPACE</div><nav aria-label="Main navigation">{views.map((item, i) => { const Icon = icons[i]; return <button key={item} className={`nav-item ${view === item ? "active" : ""}`} aria-current={view === item ? "page" : undefined} onClick={() => navigate(item)}><Icon size={19}/><span>{item}</span>{item === "Notifications" && !!state?.notifications.some(n => !n.read) && <span className="nav-count">{state.notifications.filter(n => !n.read).length}</span>}</button>; })}</nav><div className="sidebar-bottom"><div className="growth-card"><Target size={22}/><strong>Evidence. Priorities. Progress.</strong><p>Observed website issues and your organic search data, saved together.</p></div><div className="profile"><div className="avatar">YOU</div><div><strong>Personal workspace</strong><small>{hosted ? "Stored in Neon" : "Stored on this server"}</small></div></div></div></aside>
    <main className="main"><header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu size={20}/></button><a className="live-mobile-home-brand" href="/seo" aria-label="SIGNAL home"><img src="/signal-home-logo.png" alt="SIGNAL by Eric’s Designs" /></a><span>Workspace /</span><strong>{view}</strong></div><div className="topbar-actions"><WorkspaceControls darkMode={darkMode} autoRefresh={autoRefresh} toggleDarkMode={toggleDarkMode} toggleAutoRefresh={toggleAutoRefresh} onRefresh={() => Promise.all([refresh(), refreshGoogle()])} /><span className="local-badge"><span/>{activeJobs ? "Jobs active · syncing every 3s" : hosted ? "Hosted workspace" : "Local workspace"}</span></div></header><div className="content">
      <section className="page-heading"><div><div className="eyebrow">YOUR GROWTH, IN FOCUS</div><h1>{view === "Overview" ? "Your next best SEO move." : view}</h1><p>Prioritize real findings. Track organic performance. Keep a durable history.</p></div><button className="button primary" disabled={!state || !initialImportDone} onClick={() => setModal(true)}><Plus size={17}/>Add website</button></section>
      {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={16}/></button></div>}
      {failure && <div className="notice error-notice" role="alert">{failure}<button aria-label="Dismiss error" onClick={() => setFailure("")}><X size={16}/></button></div>}
      {syncError && <div className="notice error-notice" role="alert">{syncError}<button className="button secondary" onClick={() => void refresh()}>Retry sync</button></div>}
      {recovery !== null && <div className="notice error-notice"><span>Original browser data has been preserved.</span><button className="button secondary" onClick={() => download("seo-command-center-original-browser-data.json", recovery)}>Download original for recovery</button></div>}
      {!state ? <section className="card empty-state"><LoaderCircle className="spinning"/><h2>{syncError ? "Workspace unavailable" : "Loading your workspace…"}</h2><p>Waiting for a successful server response.</p></section> : <>
        {site && <div className="site-toolbar"><div className="site-selector"><Globe2 size={19}/><label className="sr-only" htmlFor="site">Website</label><select id="site" value={site.id} onChange={e => select(e.target.value)}>{state.sites.map(s => <option key={s.id} value={s.id}>{s.name} · {s.url}{s.archived ? " (archived)" : ""}</option>)}</select></div><div className="inline-actions"><label>Crawl budget <select value={budget} onChange={e => setBudget(Number(e.target.value))}>{[25, 50, 100].map(n => <option key={n} value={n}>{n} pages</option>)}</select></label><button className="button primary" disabled={!!busy || site.archived} onClick={() => { if (window.confirm(`I own or am authorized to assess ${site.url}. Queue a public-site crawl of up to ${budget} pages?`)) enqueue("audit"); }}>Approve & run audit</button></div></div>}
        {!site && !["Settings", "Integrations", "Notifications"].includes(view) ? <section className="card empty-state welcome-state"><Globe2 size={40}/><h2>{initialImportDone ? "Bring your website into SEO Command Center." : "Checking your browser workspace…"}</h2><p>{initialImportDone ? "Add its full URL. Then approve a crawl or connect an organic reporting source." : "Please wait while the one-time import decision completes."}</p><button className="button primary" disabled={!initialImportDone} onClick={() => setModal(true)}>Add your first website</button></section> : <>
          {view === "Overview" && site && <>
            <div className="kpi-grid">{[["Observed weighted SEO score", crawl ? inspectedPages ? `${crawl.score} / 100` : "Unavailable" : "—", crawl ? `${inspectedPages} pages inspected · ${when(crawl.completedAt)}` : "No crawl yet"], ["Critical issues", crawl ? String(crawl.issues.filter(i => i.severity === "critical" && i.change !== "resolved").length) : "—", "Unresolved, including not rechecked"], ["Warnings", crawl ? String(crawl.issues.filter(i => i.severity === "warning" && i.change !== "resolved").length) : "—", "Unresolved, including not rechecked"], ["Last saved Google report", report ? when(report.fetchedAt) : "—", report ? `${report.data.startDate} → ${report.data.endDate}` : "Connect a source below"]].map(([label, value, detail]) => <article className="card kpi" key={label}><div className="kpi-label">{label}</div><div className={`kpi-value ${label === "Last saved Google report" ? "kpi-date" : ""}`}>{value}</div><small>{detail}</small></article>)}</div>
            <p className="audit-scope">The observed score is a severity-weighted technical checklist for crawled pages, not a Google ranking, traffic prediction, or Core Web Vitals score.</p>
            <IssuePanel crawl={crawl}/><ReportPanel report={report} error={reportErrors[site.id]}/>
            <section className="card live-panel no-print"><h2>Refresh organic performance</h2><div className="inline-actions"><label>Period <select value={days} onChange={e => setDays(Number(e.target.value) as 7 | 30 | 90)}>{[7, 30, 90].map(n => <option key={n} value={n}>{n} days</option>)}</select></label><button className="button primary" disabled={reportBusy || (!site.bindings.siteUrl && !site.bindings.propertyId)} onClick={() => void loadReport()}>{reportBusy ? "Loading & saving…" : "Load live Google report"}</button><button className="button secondary" onClick={() => navigate("Integrations")}>Manage sources</button></div></section>
            <section className="card live-panel no-print"><h2>Export this website report</h2><div className="inline-actions"><button className="button secondary" onClick={() => download(`seo-command-center-${site.domain}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), site, crawl: crawl ?? null, report: report ?? null }, null, 2))}>Download JSON</button><button className="button secondary" onClick={() => window.print()}>Print / Save PDF</button></div><p className="body-copy">Print opens your browser’s print dialog. Choose “Save as PDF” for a readable report.</p></section>
            <JobsPanel jobs={state.jobs.filter(j => j.websiteId === site.id).slice(0, 8)}/>
          </>}
          {view === "Websites" && <div className="website-grid">{state.sites.map(s => <article className="card website-card" key={s.id}><Globe2/><h2>{s.name}</h2><p className="body-copy">{s.url}</p><p>{s.archived ? "Archived" : "Active"}</p><p className="body-copy">Last crawl: {when(state.crawls.filter(c => c.websiteId === s.id).sort((a,b) => b.completedAt.localeCompare(a.completedAt))[0]?.completedAt)}<br/>Last report: {when(state.reports.filter(r => r.websiteId === s.id).sort((a,b) => b.fetchedAt.localeCompare(a.fetchedAt))[0]?.fetchedAt)}</p><div className="inline-actions"><button className="button secondary" onClick={() => { select(s.id); navigate("Overview"); }}>Open</button><button className="button secondary" disabled={!!busy} onClick={() => { const name = window.prompt("Website name", s.name); if (name?.trim()) act({ action: "update-site", id: s.id, name: name.trim() }); }}>Rename</button><button className="button secondary" disabled={!!busy} onClick={() => { if (window.confirm(`${s.archived ? "Unarchive" : "Archive"} ${s.name}?`)) act({ action: "update-site", id: s.id, archived: !s.archived }); }}>{s.archived ? "Unarchive" : "Archive"}</button><button className="button danger" disabled={!!busy} onClick={() => { if (window.confirm(`Permanently delete ${s.name} and its associated history and schedules? Export a backup first if you need this data.`)) act({ action: "delete-site", id: s.id, confirmed: true }); }}>Delete</button></div></article>)}</div>}
          {view === "Opportunities" && <><IssuePanel crawl={crawl}/><ReportPanel report={report} error={site ? reportErrors[site.id] : undefined}/></>}
          {view === "Automations" && site && <><AutomationPanel site={site} schedules={state.schedules.filter(s => s.websiteId === site.id)} busy={!!busy} mutate={mutate} onError={setFailure} hosted={hosted}/><div className="card live-panel"><h2>Run a workflow now</h2><div className="inline-actions">{(["audit", "report", "traffic-alert"] as const).map(kind => <button className="button secondary" key={kind} disabled={!!busy || site.archived} onClick={() => { if (kind !== "audit" || window.confirm(`Approve an authorized crawl of ${site.url}?`)) enqueue(kind); }}>Queue {kind}</button>)}</div><p className="body-copy">Audit budget: {budget} pages. Report window: {days} days. Traffic alerts compare organic clicks with the previous period.</p></div><JobsPanel jobs={state.jobs.filter(j => j.websiteId === site.id)}/></>}
          {view === "Integrations" && <>
            <section className="card live-panel"><h2>Connect your organic reporting sources</h2><p className="body-copy">Authorize read-only access, then explicitly confirm the properties for each website.</p>{googleError && <p className="form-error" role="alert">{googleError}</p>}<div className="integration-grid">{(["gsc", "ga4"] as const).map(source => <article key={source}><h3>{source === "gsc" ? "Google Search Console" : "Google Analytics 4"}</h3><p className="body-copy">{!google ? "Checking…" : !google.configured ? "Server setup required (see Settings)" : google.reconnectNeeded ? "Authorization expired or revoked — reconnect this source." : google.retryable ? "Google is temporarily unavailable. Refresh status later; reconnecting is not required for a temporary outage." : googleError ? "Current source availability could not be verified. Refresh connection status." : google.services?.[source] ? "Authorized" : google.services ? "Not authorized" : google.connected ? "Google authorized; source access verified when loading" : "Not connected"}</p>{google?.configured && <a className="button secondary" href={`/api/google/connect?service=${source}`}>Connect {source.toUpperCase()}</a>}</article>)}</div><div className="inline-actions">{google?.configured && <a className="button secondary" href="/api/google/connect?service=both">Connect both sources</a>}<button className="button secondary" onClick={() => void refreshGoogle()}>Refresh connection status</button>{google?.connected && <button className="button secondary" disabled={propertyBusy} onClick={() => void loadProperties()}>{propertyBusy ? "Loading properties…" : "Reload properties"}</button>}</div>
              {site && <><div className="property-fields"><label>Search Console property<select value={site.bindings.siteUrl} disabled={!!busy} onChange={e => { const value = e.target.value; if (window.confirm(`Bind ${value || "no Search Console property"} to ${site.url}? Confirm this property belongs to this website.`)) act({ action: "update-site", id: site.id, bindings: { ...site.bindings, siteUrl: value } }); }}><option value="">Not selected</option>{site.bindings.siteUrl && !properties?.gsc.some(p => p.siteUrl === site.bindings.siteUrl) && <option>{site.bindings.siteUrl}</option>}{properties?.gsc.map(p => <option key={p.siteUrl} value={p.siteUrl}>{p.siteUrl}</option>)}</select></label><label>GA4 property<select value={site.bindings.propertyId} disabled={!!busy} onChange={e => { const value = e.target.value; if (window.confirm(`Bind GA4 property ${value || "none"} to ${site.url}?`)) act({ action: "update-site", id: site.id, bindings: { ...site.bindings, propertyId: value } }); }}><option value="">Not selected</option>{site.bindings.propertyId && !properties?.ga4.some(p => p.id === site.bindings.propertyId) && <option>{site.bindings.propertyId}</option>}{properties?.ga4.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}</select></label></div>{!!suggested?.length && <p className="body-copy">Domain-matching suggestions: {suggested.map(p => p.siteUrl).join(", ")}. Select and confirm above; suggestions are never automatically bound.</p>}{properties?.errors?.map(e => <p className="form-error" key={e}>{e}</p>)}{properties && !properties.gsc.length && <p className="body-copy">No Search Console properties returned. Check verified ownership and this account’s access.</p>}{properties && !properties.ga4.length && <p className="body-copy">No Analytics properties returned. Check GA4 account access.</p>}<button className="button primary" disabled={reportBusy || (!site.bindings.siteUrl && !site.bindings.propertyId)} onClick={() => void loadReport()}>{reportBusy ? "Loading & saving…" : "Load & save report"}</button>{reportErrors[site.id] && <p className="form-error">{reportErrors[site.id]} Your last saved report remains available.</p>}</>}
            </section>{site && <><PageSpeedPanel url={site.url}/><WordPressPanel siteUrl={new URL(site.url).origin}/></>}</>}
          {view === "Notifications" && <section className="card live-panel"><div className="live-panel-heading"><h2>Workspace notifications</h2><button className="button secondary" disabled={!!busy} onClick={() => act({ action: "read-notifications" })}>Mark all read</button></div>{!state.notifications.length && <p className="body-copy">No notifications yet. Job results and traffic alerts will appear here.</p>}{state.notifications.map(n => <article className="check-row" key={n.id}><span className="badge neutral">{n.read ? "Read" : "New"}</span><div><h3>{n.title}</h3><p>{n.message}</p><small>{when(n.createdAt)} · {state.sites.find(s => s.id === n.websiteId)?.name ?? "Website"}</small><p>Email: {n.emailStatus === "sent" ? "SMTP delivery accepted" : n.emailStatus === "failed" ? "Delivery failed" : n.emailStatus === "not-configured" ? "Not configured" : "No delivery receipt"}</p></div></article>)}</section>}
          {view === "Settings" && <><section className="card live-panel"><h2>Durable workspace & backups</h2><p className="body-copy">Websites, findings, reports, schedules, jobs and notifications live in this server’s database. Browser storage is used only for the selected website preference and one-time migration. Backups exclude credentials.</p><div className="inline-actions"><button className="button secondary" onClick={() => { void api<unknown>("/api/workspace?export=1").then(data => download("seo-command-center-workspace-backup.json", JSON.stringify(data, null, 2))).catch(e => setFailure(message(e))); }}>Download full backup</button><label className="restore-label">Restore JSON backup<input type="file" accept="application/json,.json" disabled={!!busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file || !window.confirm("Replace this server workspace with the selected backup? Export your current workspace first. Credentials will not be restored.")) return; if (file.size > 25000000) { setFailure("Backup exceeds the 25 MB import limit."); return; } void file.text().then(text => mutate({ action: "restore", backup: JSON.parse(text) as unknown, confirmed: true })).then(() => setNotice("Workspace backup restored.")).catch(error => setFailure(message(error))); }}/></label></div><p className="body-copy">Runner: {state.runner.active ? "Active" : "Idle"} · last tick {when(state.runner.lastTickAt)}. {hosted ? "Scheduled jobs are checked once a day on this Vercel plan; exact run time can vary." : "Keep the SEO Command Center server running for schedules to execute."}</p></section><section className="card live-panel"><details><summary>Operator setup: Google credentials & optional SMTP</summary><p className="body-copy">Use the project’s .env.example instructions to configure Google OAuth on the {hosted ? "Vercel project" : "server"}. Keep credentials out of browser forms and backups. Enable Search Console, Analytics Admin and Analytics Data APIs, configure the OAuth consent screen, and register the exact {hosted ? "production" : "local"} callback URL /api/google/callback on the configured app origin. {hosted ? "Add any required environment variables in Vercel and redeploy." : "Restart the server after changing environment settings."}</p><p className="body-copy">Google configuration: {google ? google.configured ? "Configured" : `Missing or invalid: ${google.missing.join(", ")}` : "Not checked"}.</p><p className="body-copy">Email is optional. Configure the SMTP server using .env.example and supply a notification address on a schedule. In-app notifications work without email. Only recorded email receipts indicate delivery acceptance.</p></details>{google?.connected && <button className="button secondary" onClick={() => { if (window.confirm("Disconnect Google from this workspace? Saved reports will remain.")) void api("/api/google/disconnect", {}).then(() => { setProperties(null); return refreshGoogle(); }).catch(e => setGoogleError(message(e))); }}>Disconnect Google</button>}</section></>}
        </>}
      </>}
      <footer className="page-footer"><span>SEO Command Center · real data, transparent limits.</span><span>{hosted ? "Hosted SEO workspace" : "Local SEO workspace"}</span></footer>
    </div></main>
    {modal && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title" ref={dialog}><button className="dialog-close icon-button" aria-label="Close add website" onClick={() => setModal(false)}><X/></button><h2 id="add-title">Add your website</h2><p>Keep the full URL, including any starting path.</p><form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); setFailure(""); void mutate({ action: "add-site", url: String(form.get("url")), name: String(form.get("name")) }).then(next => { const added = next.sites.find(s => !state?.sites.some(old => old.id === s.id)); if (added) select(added.id); setModal(false); setView("Overview"); setNotice("Website saved. Approve a crawl when you are ready."); }).catch(error => setFailure(message(error))); }}><label htmlFor="new-url">Website URL</label><input id="new-url" name="url" placeholder="https://example.com/blog/" maxLength={2048} required/><label htmlFor="new-name">Display name (optional)</label><input id="new-name" name="name" maxLength={100}/>{failure && <p className="form-error" role="alert">{failure}</p>}<p className="modal-note">Adding a website does not start a crawl.</p><button className="button primary" disabled={!!busy}>{busy ? "Saving…" : "Save website"}</button></form></div></div>}
  </div>;
}
