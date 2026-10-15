"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, ArrowUpRight, Bell, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Command, FileText, Filter, House, Inbox, LayoutDashboard, LineChart, LoaderCircle, Mail, Menu, MessageCircle, Megaphone, Plus, Search, Send, Settings2, Sparkles, Users, X } from "lucide-react";
import { addDays, csvText, displayDate, filterPosts, reportSummary, todayInZone, type Client, type Platform, type Post, type PostStatus, type SocialAction, type SocialSnapshot } from "@/lib/social-workspace";
import { ClientForm, MetricForm, PostForm } from "./social-forms";
import { AnalyticsView, CalendarView, ClientsView, NotesView, QueuePanel, SettingsForm } from "./social-views";
import { ClientAvatar, downloadFile, EmptyState, errorMessage, Modal, PlatformIcon, ReachChart, shortNumber } from "./social-ui";
import { EmailCampaignsView } from "./email-campaigns";
import { MetaAdsView } from "./meta-ads";
import { MetaInboxView } from "./meta-inbox";
import { useWorkspacePreferences, WorkspaceControls } from "./workspace-controls";

type View = "Overview" | "Content calendar" | "Inbox" | "Email campaigns" | "Clients" | "Analytics" | "Ads Manager" | "Client notes";
const navigation: { label: View; icon: LucideIcon }[] = [
  { label: "Overview", icon: House },
  { label: "Content calendar", icon: CalendarDays },
  { label: "Inbox", icon: Inbox },
  { label: "Email campaigns", icon: Mail },
  { label: "Clients", icon: Users },
  { label: "Analytics", icon: LineChart },
  { label: "Ads Manager", icon: Megaphone },
  { label: "Client notes", icon: MessageCircle },
];
const copy: Record<View, { title: string; description: string }> = {
  Overview: { title: "Your brands. One clear view.", description: "A little less switching tabs. A lot more moving things forward." },
  "Content calendar": { title: "Make room for great content.", description: "Plan, review, and organize every client's next post." },
  Inbox: { title: "Every Meta conversation, together.", description: "Bring Facebook and Instagram messages into one focused workspace." },
  "Email campaigns": { title: "Create campaigns that feel personal.", description: "Turn the context you already have into a thoughtful email sequence." },
  Clients: { title: "Every brand, in good hands.", description: "Keep client details, social profiles, and priorities together." },
  Analytics: { title: "See what is making an impact.", description: "A clear picture of the daily metrics you record for each brand." },
  "Ads Manager": { title: "Your Meta campaigns, in one view.", description: "Review campaign results and manage delivery for your connected ad accounts." },
  "Client notes": { title: "Keep the conversation moving.", description: "Capture feedback, follow-ups, and next steps for each client." },
};
type Dialog = { kind: "post"; post?: Post; date?: string } | { kind: "client"; client?: Client } | { kind: "metric" } | { kind: "settings" } | { kind: "help" } | null;

type Persistence = "unknown" | "sqlite" | "ephemeral" | "neon";
type WorkspaceResponse = { snapshot: SocialSnapshot; persistence: Persistence };
const localSnapshotKey = "signal.workspace.v1";
function readStoredSnapshot(): SocialSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(localSnapshotKey) ?? "null") as SocialSnapshot | null;
    return value?.version === 1 && Array.isArray(value.clients) && Array.isArray(value.posts) && Array.isArray(value.metrics) ? value : null;
  } catch { return null; }
}
async function requestWorkspace(action?: SocialAction, base?: SocialSnapshot): Promise<WorkspaceResponse> {
  const body = action && base ? { action: "hydrate-and-dispatch", base, next: action } : action;
  const response = await fetch("/api/social", { method: body ? "POST" : "GET", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Signal could not save that change.");
  const source = response.headers.get("x-signal-persistence");
  return { snapshot: data as SocialSnapshot, persistence: source === "ephemeral" ? "ephemeral" : source === "neon" ? "neon" : "sqlite" };
}
function MetricCard({ label, value, detail, badge, icon: Icon, tone }: { label: string; value: string; detail: string; badge: string; icon: LucideIcon; tone: string }) {
  return <article className="metric-card"><div className="metric-top"><span className={`metric-icon ${tone}`}><Icon size={17} /></span><span className="metric-label">{label}</span></div><div className="metric-value-row"><strong>{value}</strong><span className="metric-source">{badge}</span></div><div className="metric-bottom"><span>{detail}</span></div></article>;
}

export default function SocialDashboard({ showSeoLink = true, hosted = false }: { showSeoLink?: boolean; hosted?: boolean }) {
  const { darkMode, autoRefresh, toggleDarkMode, toggleAutoRefresh } = useWorkspacePreferences();
  const storedSnapshot = useMemo(() => readStoredSnapshot(), []);
  const revisionRef = useRef(hosted ? -1 : storedSnapshot?.revision ?? -1);
  // Keep the server and first client render aligned; restore the browser copy after hydration.
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [view, setView] = useState<View>("Overview");
  const [selectedId, setSelectedId] = useState("all");
  const [status, setStatus] = useState<"All" | PostStatus>("All");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState<"All" | Platform>("All");
  const [today, setToday] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mobile, setMobile] = useState(false);
  const [failure, setFailure] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState("");
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [persistence, setPersistence] = useState<Persistence>("unknown");
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const searchRef = useRef<HTMLInputElement>(null);
  const accept = useCallback((next: SocialSnapshot) => {
    if (next.revision < revisionRef.current) return;
    revisionRef.current = next.revision;
    setSnapshot(next);
    try { window.localStorage.setItem(localSnapshotKey, JSON.stringify(next)); } catch { /* Browser persistence is optional. */ }
    setSelectedId(previous => previous === "all" || next.clients.some(c => c.id === previous && !c.archived) ? previous : "all");
  }, []);
  const refresh = useCallback(async () => {
    try {
      let result = await requestWorkspace();
      if (hosted && result.persistence === "neon" && result.snapshot.revision === 0 && !result.snapshot.clients.length && storedSnapshot) {
        // Move a prior browser workspace into Neon once. Sample records are
        // removed during the import, while the user's own records are kept.
        result = await requestWorkspace({ action: "remove-examples" }, storedSnapshot);
      }
      setPersistence(result.persistence); accept(result.snapshot); setFailure("");
    } catch (error) { setFailure(errorMessage(error)); }
  }, [accept, hosted, storedSnapshot]);
  useEffect(() => {
    if (!hosted && storedSnapshot) setSnapshot(storedSnapshot);
    setToday(todayInZone()); void refresh();
    const timer = autoRefresh ? setInterval(() => { setToday(todayInZone()); void refresh(); }, 30000) : undefined;
    const handle = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); } };
    document.addEventListener("keydown", handle);
    return () => { if (timer) clearInterval(timer); document.removeEventListener("keydown", handle); };
  }, [refresh, autoRefresh]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);

  const clients = useMemo(() => snapshot?.clients.filter(c => !c.archived) ?? [], [snapshot]);
  const relevantPosts = useMemo(() => snapshot?.posts.filter(p => clients.some(c => c.id === p.clientId) && (selectedId === "all" || p.clientId === selectedId)) ?? [], [clients, snapshot, selectedId]);
  const filteredPosts = useMemo(() => filterPosts(snapshot?.posts ?? [], clients, selectedId, status, search), [snapshot, clients, selectedId, status, search]);
  const notes = snapshot?.notes.filter(n => clients.some(c => c.id === n.clientId) && (selectedId === "all" || n.clientId === selectedId)) ?? [];
  const openNotes = notes.filter(n => !n.resolved).length;
  const reviewCount = relevantPosts.filter(p => p.status === "Needs review").length;
  const scheduled = relevantPosts.filter(p => p.status === "Scheduled").length;
  const metricRows = snapshot?.metrics.filter(m => clients.some(c => c.id === m.clientId)) ?? [];
  const hasSocialProfile = clients.some(client => client.channels.length > 0);
  const hasPost = snapshot?.posts.some(post => clients.some(client => client.id === post.clientId)) ?? false;
  const setupSteps = [clients.length > 0, hasSocialProfile, hasPost];
  const setupComplete = setupSteps.filter(Boolean).length;
  const report = reportSummary(metricRows, selectedId, today ? addDays(today, -29) : "2026-10-01", today || "2026-10-01", platform);
  const activeClient = clients.find(c => c.id === selectedId);

  async function save(action: SocialAction) {
    setSaving(true);
    const pending = queue.current.catch(() => undefined).then(() => requestWorkspace(action, persistence === "ephemeral" ? snapshot ?? undefined : undefined)).then(result => { setPersistence(result.persistence); accept(result.snapshot); setFailure(""); setToast(action.action === "set-status" ? "Post approved. The publishing plan has been saved." : "Changes saved to your workspace."); });
    queue.current = pending;
    try { await pending; } finally { setSaving(false); }
  }
  function navigate(next: View) { setView(next); setMobile(false); }
  function goHome() {
    setSelectedId("all"); setStatus("All"); setSearch(""); setPlatform("All");
    navigate("Overview");
  }
  function createPost(date?: string) {
    if (!clients.some(c => c.channels.length)) { setDialog({ kind: "client" }); setToast("Add a client with a social profile to start creating posts."); return; }
    setDialog({ kind: "post", date });
  }
  function approve(post: Post) { if (saving) return; void save({ action: "set-status", id: post.id, status: "Scheduled" }).catch(error => setFailure(errorMessage(error))); }
  async function publishPost(post: Post) {
    if (publishingId || post.status !== "Scheduled") return;
    const destination = post.platform === "Instagram" ? "Eric's Designs · @eric_sdesigns" : "Eric's Designs Facebook Page";
    const caption = post.copy.length > 180 ? `${post.copy.slice(0, 177)}…` : post.copy;
    if (!window.confirm(`Publish “${post.title}” to ${destination} now?\n\n${caption}\n\nThis will make the post visible on that account.`)) return;
    setPublishingId(post.id); setFailure("");
    try {
      const response = await fetch("/api/meta/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: post.id }), cache: "no-store" });
      const data = await response.json() as { error?: string; snapshot?: SocialSnapshot; receipt?: { url: string; destination: string } };
      if (!response.ok || !data.snapshot) throw new Error(data.error || "Signal could not publish this post.");
      accept(data.snapshot); setToast(`Published to ${data.receipt?.destination ?? destination}.`);
    } catch (error) { setFailure(errorMessage(error)); }
    finally { setPublishingId(""); }
  }
  async function syncMetaInsights() {
    if (syncingMeta) return;
    setSyncingMeta(true); setFailure("");
    try {
      const response = await fetch("/api/meta/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store" });
      const data = await response.json() as { error?: string; snapshot?: SocialSnapshot; count?: number; from?: string; to?: string; destination?: string };
      if (!response.ok || !data.snapshot) throw new Error(data.error || "Signal could not sync Meta insights.");
      accept(data.snapshot);
      setToast(data.count ? `Saved ${data.count} daily Meta metric rows for ${data.destination} (${data.from} to ${data.to}).` : `Connected account confirmed. Meta returned no daily insight rows for ${data.from} to ${data.to}.`);
    } catch (error) { setFailure(errorMessage(error)); }
    finally { setSyncingMeta(false); }
  }
  function exportReport() {
    const rows: (string | number)[][] = [["Client", "Platform", "Date", "Reach", "Engagements", "Followers", "Source"]];
    metricRows.filter(m => (selectedId === "all" || m.clientId === selectedId) && (platform === "All" || m.platform === platform) && m.date >= addDays(today, -29) && m.date <= today).forEach(m => rows.push([clients.find(c => c.id === m.clientId)?.name ?? m.clientId, m.platform, m.date, m.reach, m.engagements, m.followers, m.example ? "Example" : "Manual entry"]));
    downloadFile(`signal-metrics-${today}.csv`, csvText(rows), "text/csv;charset=utf-8");
    setToast("Your 30-day metrics report was downloaded.");
  }
  function clearExamples() {
    if (clearing || !window.confirm("Remove the six starter clients and their example content, notes, and metrics? Your own clients and their records will be kept.")) return;
    setClearing(true); void save({ action: "remove-examples" }).catch(error => setFailure(errorMessage(error))).finally(() => setClearing(false));
  }
  const heading = copy[view];
  const dateHeading = today ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`)) : "YOUR AGENCY, IN FOCUS";

  return <div className="social-app">
    {mobile && <button className="mobile-nav-backdrop visible" aria-label="Close navigation" onClick={() => setMobile(false)} />}
    <aside className={`social-sidebar ${mobile ? "open" : ""}`}>
      <a className="sidebar-brand" href="/" aria-label="Signal home" onClick={event => { event.preventDefault(); goHome(); }}><img src="/signal-home-logo.png" alt="SIGNAL by Eric’s Designs" /></a>
      <button className="workspace-picker" onClick={() => setDialog({ kind: "settings" })}><span className="workspace-symbol"><Command size={16} /></span><span className="workspace-picker-copy"><strong>{snapshot?.agencyName ?? "Your agency"}</strong><small>Social media workspace</small></span><ChevronDown size={14} /></button>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">{navigation.map(({ label, icon: Icon }) => { const isHome = label === "Overview"; return <button key={label} className={view === label ? "active" : ""} aria-current={view === label ? "page" : undefined} onClick={() => isHome ? goHome() : navigate(label)}><Icon size={18} /><span>{isHome ? "Home" : label}</span>{label === "Client notes" && openNotes > 0 && <span className="nav-badge">{openNotes}</span>}</button>; })}</nav>
      {showSeoLink && <a className="seo-workspace-link" href="/seo" aria-label="Open SEO Command Center workspace"><LayoutDashboard size={16} /><span>Open SEO Command Center</span><ArrowUpRight size={14} /></a>}<div className="sidebar-section-label clients-label">CLIENTS<button className="sidebar-add" aria-label="Add client" disabled={!snapshot} onClick={() => setDialog({ kind: "client" })}><Plus size={14} /></button></div>
      <div className="sidebar-clients">{clients.slice(0, 5).map(client => <button key={client.id} className={selectedId === client.id ? "selected" : ""} onClick={() => { setSelectedId(client.id); setStatus("All"); navigate("Overview"); }}><ClientAvatar client={client} size="small" /><span>{client.name}</span><span className={`client-status ${snapshot?.posts.some(p => p.clientId === client.id && p.status === "Needs review") ? "attention" : ""}`} /></button>)}<button className="view-all-clients" onClick={() => { setSelectedId("all"); navigate("Clients"); }}><Users size={16} />View all clients<span className="client-count">{clients.length}</span></button></div>
      <div className="sidebar-bottom"><button className="help-card" onClick={() => setDialog({ kind: "help" })}><span className="help-icon"><Sparkles size={15} /></span><span><strong>A calmer way to manage.</strong><small>Your Signal quick guide</small></span><ArrowUpRight size={14} /></button><button className="sidebar-settings" disabled={!snapshot} onClick={() => setDialog({ kind: "settings" })}><Settings2 size={16} /><span>Workspace settings</span></button><div className="sidebar-user"><span className="user-avatar">YOU</span><div><strong>Agency workspace</strong><span>{persistence === "neon" ? "Stored in Neon" : persistence === "ephemeral" ? "Browser-local storage" : "Local · persistent storage"}</span></div></div></div>
    </aside>
    <main className="social-main">
      <header className="social-topbar"><div className="topbar-left"><button className="mobile-menu-button" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu size={20} /></button><a className="social-mobile-home-brand" href="/" aria-label="SIGNAL home" onClick={event => { event.preventDefault(); goHome(); }}><img src="/signal-home-logo.png" alt="SIGNAL by Eric’s Designs" /></a><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{view}</strong></div></div><div className="topbar-actions"><label className="search-box"><Search size={16} /><input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients & content" aria-label="Search clients and content" /><kbd>Ctrl K</kbd></label><button className="topbar-icon-button" aria-label="Help" onClick={() => setDialog({ kind: "help" })}><CircleHelp size={18} /></button><button className="topbar-icon-button notification-button" aria-label="Show pending approvals" onClick={() => { setStatus("Needs review"); navigate("Overview"); }}><Bell size={18} />{!!reviewCount && <span />}</button><WorkspaceControls darkMode={darkMode} autoRefresh={autoRefresh} toggleDarkMode={toggleDarkMode} toggleAutoRefresh={toggleAutoRefresh} onRefresh={() => { setToday(todayInZone()); return refresh(); }} /><span className="topbar-avatar">YOU</span></div></header>
       <div className="social-content"><section className="page-intro"><div><span className="eyebrow">{view === "Overview" ? dateHeading : view === "Email campaigns" ? "EMAIL CAMPAIGN WORKSPACE" : "YOUR SOCIAL MEDIA WORKSPACE"}</span><h1>{heading.title}</h1><p>{heading.description}</p></div>{view === "Email campaigns" ? <div className="campaign-intro-note"><Mail size={15} /><span>Draft, personalize, export</span></div> : <div className="intro-actions"><button className="button secondary" onClick={exportReport} disabled={!snapshot || !today}><Send size={15} />Export report</button><button className="button primary" disabled={!snapshot} onClick={() => createPost()}><Plus size={16} />Create post</button></div>}</section>
        {failure && <div className="data-banner error" role="alert"><span><Bell size={15} />{failure}</span><button onClick={() => void refresh()}>Retry sync</button></div>}
        {!snapshot ? <section className="panel loading-workspace"><LoaderCircle size={25} className="social-spinning" /><h2>{failure ? "Workspace unavailable" : "Loading your workspace…"}</h2><p>{failure ? "Check that the local server is running, then retry." : "Clients, content, and saved reports are on their way."}</p></section> : <>
          {snapshot.clients.some(c => c.example) && <div className="data-banner"><span><Sparkles size={15} /><strong>Starter workspace</strong> Explore with six sample brands, then make it your own.</span><button disabled={clearing} onClick={clearExamples}>{clearing ? "Clearing…" : "Clear starter data"}</button></div>}
           {view !== "Email campaigns" && <div className="client-filter-bar"><span className="client-filter-label"><Filter size={15} />Showing</span><button className={`client-filter ${selectedId === "all" ? "active" : ""}`} onClick={() => setSelectedId("all")}>All clients<span>{clients.length}</span></button>{clients.slice(0, 4).map(client => <button className={`client-filter ${selectedId === client.id ? "active" : ""}`} key={client.id} onClick={() => setSelectedId(client.id)}><ClientAvatar client={client} size="small" />{client.name}</button>)}{clients.length > 4 && <label className="client-filter-extra"><span className="sr-only">More clients</span><select value={clients.slice(4).some(c => c.id === selectedId) ? selectedId : ""} onChange={e => setSelectedId(e.target.value)}><option value="" disabled>+{clients.length - 4} more</option>{clients.slice(4).map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>}</div>}
          {view === "Overview" && <>
            {setupComplete < setupSteps.length && <section className="panel onboarding-panel" aria-labelledby="onboarding-title">
              <div className="onboarding-intro">
                <span className="onboarding-icon"><Sparkles size={18} /></span>
                <div><span className="eyebrow">YOUR FIRST STEPS</span><h2 id="onboarding-title">Make SIGNAL yours</h2><p>Set up the basics to start planning real client work.</p></div>
                <span className="onboarding-progress">{setupComplete} of {setupSteps.length} complete</span>
              </div>
              <ol className="onboarding-steps">
                <li className={setupSteps[0] ? "complete" : ""}><span className="onboarding-step-state">{setupSteps[0] ? <Check size={15} /> : "1"}</span><div><strong>Add your first client</strong><small>Keep each brand and its channels organized.</small></div>{!setupSteps[0] && <button className="button primary" onClick={() => setDialog({ kind: "client" })}><Plus size={14} />Add client</button>}</li>
                <li className={setupSteps[1] ? "complete" : ""}><span className="onboarding-step-state">{setupSteps[1] ? <Check size={15} /> : "2"}</span><div><strong>Add a social profile</strong><small>Choose the platforms you manage for a client.</small></div>{!setupSteps[1] && <button className="button secondary" onClick={() => clients.length ? navigate("Clients") : setDialog({ kind: "client" })}>{clients.length ? "Open clients" : "Add a client"}<ArrowUpRight size={14} /></button>}</li>
                <li className={setupSteps[2] ? "complete" : ""}><span className="onboarding-step-state">{setupSteps[2] ? <Check size={15} /> : "3"}</span><div><strong>Create your first post</strong><small>Save a draft or send it for review. Nothing publishes automatically.</small></div>{!setupSteps[2] && <button className="button secondary" disabled={!hasSocialProfile} onClick={() => createPost()}>{hasSocialProfile ? "Create a post" : "Add a profile first"}<ArrowUpRight size={14} /></button>}</li>
              </ol>
              <div className="onboarding-footer"><span>Optional next step</span><button className="text-button" onClick={() => setDialog({ kind: "settings" })}>Review workspace connections <ArrowUpRight size={14} /></button>{showSeoLink && <a className="text-button" href="/seo">Open SEO workspace <ArrowUpRight size={14} /></a>}</div>
            </section>}
            <section className="metrics-grid"><MetricCard label="Total reach" value={report.count ? shortNumber(report.reach) : "—"} detail="Sum of daily reach · last 30 days" badge={report.example ? "Example" : "Recorded"} icon={Activity} tone="mint" /><MetricCard label="Engagement rate" value={report.rate == null ? "—" : `${report.rate.toFixed(1)}%`} detail="Engagements ÷ recorded daily reach" badge={report.example ? "Example" : "Recorded"} icon={Sparkles} tone="lavender" /><MetricCard label="Scheduled posts" value={String(scheduled)} detail="Planning queue · publish manually" badge="Saved" icon={CalendarDays} tone="peach" /><MetricCard label="Needs approval" value={String(reviewCount)} detail={activeClient ? activeClient.name : `Across ${clients.length} active clients`} badge="Review" icon={Clock3} tone="rose" /></section>
            <div className="overview-grid"><section className="panel performance-panel"><div className="panel-heading"><div><span className="eyebrow">LAST 30 DAYS · {report.example ? "EXAMPLE METRICS" : "MANUAL REPORTING"}</span><h2>Content performance</h2></div><div className="panel-heading-actions"><span className="chart-total">{report.count ? shortNumber(report.reach) : "—"}<small> reach</small></span><label className="select-button"><span className="sr-only">Performance channel</span><select value={platform} onChange={e => setPlatform(e.target.value as "All" | Platform)}><option value="All">All channels</option>{[...new Set(clients.flatMap(c => c.channels.map(channel => channel.platform)))].map(p => <option key={p}>{p}</option>)}</select></label></div></div><div className="chart-legend"><span><i className="legend-swatch reach" />Daily reach</span><span>{report.count} saved daily records</span></div>{report.count ? <ReachChart days={report.daily} /> : <EmptyState title="Your next report starts here" description="Record metrics from each platform to track your results." children={<button className="text-button" onClick={() => setDialog({ kind: "metric" })}>Record metrics <Plus size={13} /></button>} />}</section><section className="panel attention-panel"><div className="panel-heading"><div><span className="eyebrow">ACTION NEEDED</span><h2>Keep things moving</h2></div></div><div className="attention-list"><button className="attention-item" onClick={() => setStatus("Needs review")}><span className="attention-icon peach"><FileText size={17} /></span><span><strong>{reviewCount} posts need approval</strong><small>Review captions and creative before publishing</small></span><ArrowUpRight size={15} /></button><button className="attention-item" onClick={() => navigate("Client notes")}><span className="attention-icon lavender"><MessageCircle size={17} /></span><span><strong>{openNotes} open client notes</strong><small>Feedback, follow-ups, and next steps</small></span><ArrowUpRight size={15} /></button><button className="attention-item" onClick={() => navigate("Clients")}><span className="attention-icon rose"><Users size={17} /></span><span><strong>{clients.filter(c => !c.channels.length || c.channels.some(ch => !ch.url)).length} clients need profile details</strong><small>Add the public profiles your team manages</small></span><ArrowUpRight size={15} /></button></div><button className="text-button" onClick={() => navigate("Content calendar")}>Open content calendar <ArrowUpRight size={14} /></button></section></div>
            <QueuePanel posts={filteredPosts} clients={clients} status={status} setStatus={setStatus} edit={post => setDialog({ kind: "post", post })} approve={approve} publish={publishPost} publishingId={publishingId} busy={saving} openCalendar={() => navigate("Content calendar")} limit={5} />
            <section className="panel portfolio-panel"><div className="panel-heading"><div><span className="eyebrow">CLIENT PULSE</span><h2>Portfolio at a glance</h2></div><button className="text-button" onClick={() => { setSelectedId("all"); navigate("Clients"); }}>View all clients <ArrowUpRight size={14} /></button></div><div className="portfolio-grid">{clients.filter(c => selectedId === "all" || c.id === selectedId).slice(0, 4).map(client => {
              const clientPosts = snapshot.posts.filter(p => p.clientId === client.id), reviews = clientPosts.filter(p => p.status === "Needs review").length;
              const latest = metricRows.filter(m => m.clientId === client.id).sort((a, b) => b.date.localeCompare(a.date))[0];
              return <button className="client-pulse" key={client.id} onClick={() => { setSelectedId(client.id); navigate("Clients"); }}><div className="pulse-head"><ClientAvatar client={client} /><span className={`pulse-status ${reviews ? "attention" : "on-track"}`}>{reviews ? "Needs review" : "On track"}</span><ArrowUpRight size={14} /></div><strong>{client.name}</strong><span className="pulse-handle">{client.handle || "Add a primary handle"}</span><div className="pulse-details"><span><b>{latest ? shortNumber(latest.followers) : "—"}</b>latest channel followers</span><span><b>{clientPosts.filter(p => p.status === "Scheduled").length}</b>planned posts</span></div><div className="pulse-platforms">{client.channels.map(ch => <PlatformIcon key={ch.platform} platform={ch.platform} size={13} />)}<span className="pulse-last">{client.example ? "Example brand" : "Saved client"}</span></div></button>;
            })}</div>{!clients.length && <EmptyState title="Make room for your first client" description="Add a brand and the social channels you manage." children={<button className="button primary" onClick={() => setDialog({ kind: "client" })}><Plus size={14} />Add client</button>} />}</section>
          </>}
          {view === "Content calendar" && <CalendarView posts={filteredPosts} clients={clients} today={today} status={status} setStatus={setStatus} edit={post => setDialog({ kind: "post", post })} create={createPost} approve={approve} publish={publishPost} publishingId={publishingId} busy={saving} />}
          {view === "Inbox" && <MetaInboxView />}
           {view === "Clients" && <ClientsView snapshot={snapshot} selectedId={selectedId} search={search} create={() => setDialog({ kind: "client" })} edit={client => setDialog({ kind: "client", client })} open={client => { setSelectedId(client.id); setStatus("All"); navigate("Content calendar"); }} save={save} />}
           {view === "Email campaigns" && <EmailCampaignsView clients={clients} selectedId={selectedId} />}
           {view === "Analytics" && <AnalyticsView snapshot={snapshot} clients={clients} selectedId={selectedId} today={today} record={() => setDialog({ kind: "metric" })} syncMeta={() => void syncMetaInsights()} syncingMeta={syncingMeta} />}
          {view === "Ads Manager" && <MetaAdsView />}
          {view === "Client notes" && <NotesView clients={clients} notes={notes} selectedId={selectedId} search={search} save={save} />}
          <footer className="social-footer"><span><span className="footer-dot" />{saving ? "Saving changes…" : persistence === "neon" ? "Saved to Neon" : persistence === "ephemeral" ? "Saved in this browser" : "Saved to local server"}</span><span>Signal · {snapshot.updatedAt ? `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })} IST` : "Ready"}</span></footer>
        </>}
      </div>
    </main>
    {dialog?.kind === "client" && <ClientForm key={dialog.client?.id ?? "new"} client={dialog.client} onClose={() => setDialog(null)} save={save} storageLabel={persistence === "neon" ? "Saved to Neon" : persistence === "ephemeral" ? "Saved in this browser" : persistence === "sqlite" ? "Saved on this server" : "Checking storage…"} />}
    {dialog?.kind === "post" && <PostForm key={dialog.post?.id ?? "new"} post={dialog.post} clients={clients} clientId={selectedId} date={dialog.date} onClose={() => setDialog(null)} save={save} />}
    {dialog?.kind === "metric" && <MetricForm clients={clients} clientId={selectedId} onClose={() => setDialog(null)} save={save} />}
    {dialog?.kind === "settings" && snapshot && <SettingsForm snapshot={snapshot} save={save} onClose={() => setDialog(null)} />}
    {dialog?.kind === "help" && <Modal title="A calmer social workflow" description="Your agency's client, planning, and reporting workspace." onClose={() => setDialog(null)}><ol className="help-steps"><li><strong>Add your clients.</strong><p>Store contact details, platform handles, and profile links. Seven social platforms are supported as profile records.</p></li><li><strong>Plan content together.</strong><p>Create captions, attach a creative link, request review, and approve posts into the calendar. All dates and times are in IST.</p></li><li><strong>Publish and track.</strong><p>Publish on each platform, then add the live post URL and mark it published. Record daily metrics and download a CSV report.</p></li></ol><div className="integration-note"><strong>Platform integration status</strong><p>Meta is connected for the Eric's Designs Page and linked Instagram profile. Facebook and Instagram publishing requires a per-post confirmation, and daily Meta insights can sync from Analytics. Comments and individual client logins are not included. Local data is saved in SQLite; the hosted workspace is saved in Neon.</p></div><button className="button primary" onClick={() => setDialog(null)}>Got it <Check size={14} /></button></Modal>}
    {toast && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span>{toast}<button aria-label="Dismiss message" onClick={() => setToast("")}><X size={14} /></button></div>}
  </div>;
}
