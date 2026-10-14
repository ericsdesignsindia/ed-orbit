"use client";

import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Eye, FileText, Filter, Hash, House, Instagram, Menu, MessageCircle, MoreHorizontal, Plus, Search, Send, Settings2, Sparkles, Users, X } from "lucide-react";

type DemoView = "Overview" | "Content calendar" | "Inbox" | "Clients" | "Analytics";
type DemoPost = { id: number; client: string; initials: string; channel: "Instagram" | "Facebook" | "LinkedIn"; title: string; date: string; status: "Needs approval" | "Scheduled" | "Draft"; color: string };

const navItems: { label: DemoView; icon: typeof House }[] = [
  { label: "Overview", icon: House },
  { label: "Content calendar", icon: CalendarDays },
  { label: "Inbox", icon: MessageCircle },
  { label: "Clients", icon: Users },
  { label: "Analytics", icon: Activity },
];

const initialPosts: DemoPost[] = [
  { id: 1, client: "Northstar Coffee", initials: "NC", channel: "Instagram", title: "A slower start, a better cup", date: "Today · 11:30 AM", status: "Needs approval", color: "peach" },
  { id: 2, client: "Field & Form", initials: "FF", channel: "Facebook", title: "Meet the autumn collection", date: "Today · 3:00 PM", status: "Scheduled", color: "sage" },
  { id: 3, client: "Goodwell Studio", initials: "GS", channel: "LinkedIn", title: "Small habits, lasting change", date: "Tomorrow · 9:00 AM", status: "Draft", color: "lilac" },
];

const sections: Record<DemoView, { eyebrow: string; title: string; subtitle: string }> = {
  Overview: { eyebrow: "WEDNESDAY, OCTOBER 14", title: "Your brands. One clear view.", subtitle: "A little less switching tabs. A lot more moving things forward." },
  "Content calendar": { eyebrow: "CONTENT PLANNING", title: "Good content, right on time.", subtitle: "See what is planned, what needs a review, and what is ready to go." },
  Inbox: { eyebrow: "COMMUNITY CARE", title: "Keep every conversation moving.", subtitle: "Bring client messages and follow-ups into one focused view." },
  Clients: { eyebrow: "YOUR CLIENTS", title: "Every brand, in good hands.", subtitle: "Keep the people, channels, and priorities you manage close by." },
  Analytics: { eyebrow: "PERFORMANCE", title: "See what is making an impact.", subtitle: "Review the signals behind your social media work." },
};

export default function SignalDemo() {
  const [view, setView] = useState<DemoView>("Overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [posts, setPosts] = useState(initialPosts);
  const [clientFilter, setClientFilter] = useState("All clients");
  const [query, setQuery] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [caption, setCaption] = useState("");
  const [toast, setToast] = useState("");

  const visiblePosts = useMemo(() => posts.filter(post => (clientFilter === "All clients" || post.client === clientFilter) && `${post.client} ${post.title} ${post.channel}`.toLowerCase().includes(query.toLowerCase())), [posts, clientFilter, query]);
  const heading = sections[view];

  function createDraft() {
    if (!caption.trim()) return;
    setPosts(current => [{ id: Date.now(), client: clientFilter === "All clients" ? "Northstar Coffee" : clientFilter, initials: clientFilter === "All clients" ? "NC" : clientFilter.split(" ").map(part => part[0]).join("").slice(0, 2), channel: "Instagram", title: caption.trim(), date: "Just now · Demo only", status: "Draft", color: "peach" }, ...current]);
    setCaption("");
    setShowComposer(false);
    setToast("Draft added to this demo workspace");
    window.setTimeout(() => setToast(""), 3000);
  }

  return <div className="signal-demo">
    <div className="demo-ribbon"><Sparkles size={13} /> INTERACTIVE PRODUCT DEMO <span>Sample workspace · changes stay in this browser session</span></div>
    <div className="demo-layout">
      <aside className={`demo-sidebar ${mobileNav ? "open" : ""}`}>
        <a className="demo-brand" href="/" aria-label="SIGNAL home"><img src="/signal-logo-landscape.jpg" alt="SIGNAL by Eric’s Designs" /></a>
        <button className="demo-workspace"><span className="workspace-mark">S</span><span><b>Eric’s Designs</b><small>Demo workspace</small></span><ChevronDown size={15} /></button>
        <div className="demo-section-label">WORKSPACE</div>
        <nav className="demo-nav" aria-label="Demo navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={view === label ? "selected" : ""} onClick={() => { setView(label); setMobileNav(false); }}><Icon size={17} /><span>{label}</span>{label === "Inbox" && <i>3</i>}</button>)}</nav>
        <div className="demo-section-label clients-label">CLIENTS <button aria-label="Add client" onClick={() => { setView("Clients"); setToast("Client setup is available in the full workspace."); window.setTimeout(() => setToast(""), 2800); }}><Plus size={14} /></button></div>
        <div className="demo-client-list">{[["NC", "Northstar Coffee", "peach"], ["FF", "Field & Form", "sage"], ["GS", "Goodwell Studio", "lilac"]].map(([initials, name, tone]) => <button key={name} className={clientFilter === name ? "chosen" : ""} onClick={() => { setClientFilter(clientFilter === name ? "All clients" : name); setView("Overview"); }}><span className={`demo-client-avatar ${tone}`}>{initials}</span><span>{name}</span><span className="client-dot" /></button>)}</div>
        <div className="demo-sidebar-bottom"><button onClick={() => { setView("Analytics"); setMobileNav(false); }}><Settings2 size={16} /> Workspace settings</button><div className="demo-profile"><span className="profile-avatar">ED</span><span><b>Eric’s Designs</b><small>Agency workspace</small></span><MoreHorizontal size={17} /></div></div>
      </aside>

      <main className="demo-main">
        <header className="demo-topbar"><div className="demo-top-left"><button className="demo-mobile-menu" aria-label="Open menu" onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={20} /> : <Menu size={20} />}</button><div className="demo-breadcrumb"><span>Workspace</span><span>/</span><b>{view}</b></div></div><div className="demo-top-actions"><label className="demo-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search demo workspace" /><kbd>⌘ K</kbd></label><button aria-label="Help" className="demo-icon-button"><CircleHelp size={18} /></button><button aria-label="Notifications" className="demo-icon-button notification"><Bell size={18} /><i /></button><span className="demo-top-avatar">ED</span></div></header>
        <div className="demo-content">
          <section className="demo-intro"><div><div className="demo-eyebrow">{heading.eyebrow}</div><h1>{heading.title}</h1><p>{heading.subtitle}</p></div><div className="demo-intro-actions"><button className="demo-button outline" onClick={() => setToast("Your report preview is ready in this demo.") }><Send size={15} /> Export report</button><button className="demo-button yellow" onClick={() => setShowComposer(true)}><Plus size={17} /> Create post</button></div></section>

          <div className="demo-filter"><Filter size={16} /><span>Showing</span><select value={clientFilter} onChange={event => setClientFilter(event.target.value)} aria-label="Filter by client"><option>All clients</option><option>Northstar Coffee</option><option>Field &amp; Form</option><option>Goodwell Studio</option></select><span className="filter-count">{clientFilter === "All clients" ? 3 : 1} clients</span><span className="demo-example-label"><Eye size={13} /> Sample data</span></div>

          <section className="demo-metrics" aria-label="Social media summary"><Metric icon={<Activity size={18} />} label="Total reach" value="48.2K" change="↑ 12.8%" helper="Across connected channels" /><Metric icon={<Sparkles size={18} />} label="Engagement rate" value="4.8%" change="↑ 0.6%" helper="Average this month" /><Metric icon={<CalendarDays size={18} />} label="Scheduled posts" value={String(posts.filter(post => post.status === "Scheduled").length + 11)} change="This month" helper="Across 3 client brands" /><Metric icon={<Clock3 size={18} />} label="Needs approval" value={String(posts.filter(post => post.status === "Needs approval").length)} change="Review" helper="Waiting for client feedback" /></section>

          {view === "Inbox" ? <section className="demo-lower-grid"><div className="demo-card"><div className="demo-card-heading"><div><span className="demo-eyebrow">RECENT MESSAGES</span><h2>Conversations to follow up</h2></div><button className="demo-link-button">Open inbox <ArrowRight size={14} /></button></div>{[["MP", "Mia Parker", "Northstar Coffee", "Do you have oat milk options?", "12m", "peach"], ["JL", "James Lee", "Field & Form", "Love this collection!", "48m", "sage"], ["AR", "Ava Reed", "Goodwell Studio", "Could you share more details?", "2h", "lilac"]].map(([initials, name, brand, message, time, tone]) => <div className="demo-message" key={name}><span className={`demo-client-avatar ${tone}`}>{initials}</span><span className="message-body"><b>{name}<small>{brand}</small></b><span>{message}</span></span><time>{time}</time></div>)}</div><div className="demo-card demo-tip"><span className="tip-icon"><MessageCircle size={18} /></span><div className="demo-eyebrow">COMMUNITY CARE</div><h2>Good conversations build good brands.</h2><p>Keep messages, client context, and follow-ups organized together.</p><button className="demo-button outline" onClick={() => setToast("Inbox connections are configured in the full workspace.")}>Explore inbox tools <ArrowRight size={14} /></button></div></section>
          : view === "Clients" ? <section className="demo-card client-directory"><div className="demo-card-heading"><div><span className="demo-eyebrow">CLIENT DIRECTORY</span><h2>Brands in your workspace</h2></div><span className="sample-pill">3 sample clients</span></div><div className="demo-client-cards">{[["NC", "Northstar Coffee", "Food & beverage", "Instagram · Facebook", "peach"], ["FF", "Field & Form", "Retail & lifestyle", "Instagram · Facebook", "sage"], ["GS", "Goodwell Studio", "Health & wellness", "Instagram · LinkedIn", "lilac"]].map(([initials, name, category, channels, tone]) => <article key={name}><span className={`demo-client-avatar large ${tone}`}>{initials}</span><b>{name}</b><span>{category}</span><small>{channels}</small><button className="demo-link-button" onClick={() => { setClientFilter(name); setView("Overview"); }}>View workspace <ArrowRight size={13} /></button></article>)}</div></section>
          : <section className="demo-lower-grid"><div className="demo-card demo-performance"><div className="demo-card-heading"><div><span className="demo-eyebrow">LAST 30 DAYS · SAMPLE REPORT</span><h2>{view === "Content calendar" ? "Upcoming content" : view === "Analytics" ? "Social performance" : "Content performance"}</h2></div><button className="demo-link-button" onClick={() => setView("Content calendar")}>View calendar <ArrowRight size={14} /></button></div>{view === "Analytics" ? <div className="demo-chart"><div className="chart-labels"><span>60K</span><span>40K</span><span>20K</span><span>0</span></div><div className="chart-bars">{[38,52,44,66,57,75,62,84,70,91,78,98,73,87,100,80,93,70,88,96,76,90,67,82,99,74,86,94,72,91].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div> : <div className="demo-post-list">{visiblePosts.length ? visiblePosts.slice(0, 4).map(post => <PostRow key={post.id} post={post} onApprove={() => { setPosts(current => current.map(item => item.id === post.id ? { ...item, status: "Scheduled" } : item)); setToast("Approved in demo workspace"); window.setTimeout(() => setToast(""), 2500); }} />) : <div className="demo-empty">No matching demo posts. Try another client or search term.</div>}</div>}</div><div className="demo-card demo-attention"><div className="demo-card-heading"><div><span className="demo-eyebrow">ACTION NEEDED</span><h2>Keep things moving</h2></div></div><div className="demo-action-item"><span className="action-icon yellow-bg"><FileText size={17} /></span><span><b>{posts.filter(post => post.status === "Needs approval").length} post needs approval</b><small>Review copy before it goes live</small></span><ArrowUpRight size={15} /></div><div className="demo-action-item"><span className="action-icon lilac-bg"><MessageCircle size={17} /></span><span><b>3 client messages</b><small>Follow up with your community</small></span><ArrowUpRight size={15} /></div><div className="demo-action-item"><span className="action-icon peach-bg"><Hash size={17} /></span><span><b>Weekly plan in progress</b><small>Content mapped across 3 brands</small></span><ArrowDownRight size={15} /></div><div className="demo-quote"><Sparkles size={15} /><span>Clear priorities make better work.</span></div></div></section>}

          <div className="demo-footer-note"><span><span className="demo-status-dot" /> DEMO MODE</span><span>All names, metrics, and posts are illustrative sample content.</span></div>
        </div>
      </main>
    </div>

    {showComposer && <div className="demo-modal-backdrop" onClick={() => setShowComposer(false)}><section className="demo-modal" role="dialog" aria-modal="true" aria-labelledby="demo-composer-title" onClick={event => event.stopPropagation()}><div className="demo-modal-heading"><div><span className="demo-eyebrow">DEMO COMPOSER</span><h2 id="demo-composer-title">Create a sample post</h2></div><button onClick={() => setShowComposer(false)} aria-label="Close"><X size={18} /></button></div><label>Caption<textarea autoFocus value={caption} onChange={event => setCaption(event.target.value)} placeholder="Write a sample caption..." /></label><div className="demo-composer-meta"><span><Instagram size={15} /> Instagram</span><span>{clientFilter === "All clients" ? "Northstar Coffee" : clientFilter}</span></div><div className="demo-modal-actions"><button className="demo-button outline" onClick={() => setShowComposer(false)}>Cancel</button><button className="demo-button yellow" disabled={!caption.trim()} onClick={createDraft}><Plus size={16} /> Save demo draft</button></div><p className="demo-modal-note">This creates a temporary sample inside this demo only. It will not publish or send anything.</p></section></div>}
    {toast && <div className="demo-toast"><Check size={15} /> {toast}</div>}
  </div>;
}

function Metric({ icon, label, value, change, helper }: { icon: React.ReactNode; label: string; value: string; change: string; helper: string }) {
  return <article className="demo-metric"><div className="metric-heading"><span className="metric-icon">{icon}</span><span>{label}</span></div><div className="metric-value">{value}<span>{change}</span></div><small>{helper}</small></article>;
}

function PostRow({ post, onApprove }: { post: DemoPost; onApprove: () => void }) {
  return <div className="demo-post-row"><span className={`demo-client-avatar ${post.color}`}>{post.initials}</span><div className="post-copy"><b>{post.title}</b><span>{post.client} <i>·</i> {post.channel}</span></div><span className="post-date">{post.date}</span><span className={`post-status ${post.status === "Needs approval" ? "review" : post.status === "Scheduled" ? "scheduled" : "draft"}`}>{post.status === "Scheduled" && <Check size={11} />}{post.status}</span>{post.status === "Needs approval" ? <button className="approve-button" onClick={onApprove}>Review</button> : <button className="post-more" aria-label={`More options for ${post.title}`}><MoreHorizontal size={17} /></button>}</div>;
}
