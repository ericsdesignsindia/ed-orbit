"use client";

import { useState } from "react";
import { Check, Info, Plus, Trash2 } from "lucide-react";
import { addDays, PLATFORMS, POST_STATUSES, POST_TYPES, todayInZone, type Channel, type Client, type Post, type SocialAction } from "@/lib/social-workspace";
import { errorMessage, FormError, Modal, PlatformIcon } from "./social-ui";

type Save = (action: SocialAction) => Promise<void>;

export function ClientForm({ client, onClose, save, storageLabel }: { client?: Client; onClose: () => void; save: Save; storageLabel: string }) {
  const [name, setName] = useState(client?.name ?? "");
  const [handle, setHandle] = useState(client?.handle ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [channels, setChannels] = useState<Channel[]>(client?.channels ?? [{ platform: "Instagram", handle: "", url: "" }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await save({ action: "save-client", client: { ...(client ? { id: client.id } : {}), name, handle, email, channels } }); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title={client ? "Edit client & channels" : "Add a client"} description="Save the brand details and public profiles your agency manages." onClose={onClose}><form onSubmit={event => void submit(event)}><label>Client name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required placeholder="Willow & Co." /></label><div className="form-grid"><label>Primary handle<input value={handle} onChange={e => setHandle(e.target.value)} maxLength={100} placeholder="@brandhandle" /></label><label>Contact email<input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} placeholder="client@example.com" /></label></div><fieldset className="channel-fields"><legend>Social profiles</legend><p>These are saved profile records. Platform authorization is not connected.</p><div className="platform-checks">{PLATFORMS.map(platform => <label key={platform}><input type="checkbox" checked={channels.some(c => c.platform === platform)} onChange={e => setChannels(previous => e.target.checked ? [...previous, { platform, handle, url: "" }] : previous.filter(c => c.platform !== platform))} /><PlatformIcon platform={platform} />{platform}</label>)}</div>{channels.map(channel => <div className="channel-edit" key={channel.platform}><strong><PlatformIcon platform={channel.platform} />{channel.platform}</strong><div className="form-grid"><label>Handle<input value={channel.handle} onChange={e => setChannels(previous => previous.map(c => c.platform === channel.platform ? { ...c, handle: e.target.value } : c))} placeholder="@brandhandle" maxLength={100} /></label><label>Profile URL<input type="url" value={channel.url} onChange={e => setChannels(previous => previous.map(c => c.platform === channel.platform ? { ...c, url: e.target.value } : c))} placeholder="https://…" maxLength={2048} /></label></div></div>)}</fieldset><FormError error={error} /><div className="modal-footer"><span className="save-note">{storageLabel}</span><button className="button primary" disabled={busy}>{busy ? "Saving…" : client ? "Save changes" : "Add client"}<Check size={15} /></button></div></form></Modal>;
}

export function PostForm({ post, clients, clientId, date, onClose, save }: { post?: Post; clients: Client[]; clientId: string; date?: string; onClose: () => void; save: Save }) {
  const eligible = clients.filter(c => !c.archived && c.channels.length > 0);
  const selected = eligible.find(c => c.id === (post?.clientId ?? clientId)) ?? eligible[0];
  const [selectedId, setSelectedId] = useState(selected?.id ?? "");
  const [platform, setPlatform] = useState(post?.platform ?? selected?.channels[0]?.platform ?? "Instagram");
  const [title, setTitle] = useState(post?.title ?? "");
  const [copy, setCopy] = useState(post?.copy ?? "");
  const [plannedDate, setDate] = useState(post?.date ?? date ?? addDays(todayInZone(), 1));
  const [time, setTime] = useState(post?.time ?? "09:00");
  const [status, setStatus] = useState(post?.status ?? "Draft");
  const [type, setType] = useState(post?.type ?? "Static");
  const [assetUrl, setAssetUrl] = useState(post?.assetUrl ?? "");
  const [publishedUrl, setPublishedUrl] = useState(post?.publishedUrl ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const client = eligible.find(c => c.id === selectedId);
  const isSignalPublishingClient = client?.name.toLowerCase().replace(/[^a-z0-9]/g, "") === "ericsdesigns";
  const instagramMediaReady = /^https:\/\//i.test(assetUrl);
  const publishGuidance = !isSignalPublishingClient
    ? "Signal publishing is connected only for Eric's Designs. You can still save this as a draft or planning item."
    : platform === "Instagram"
      ? type === "Carousel"
        ? "Carousel publishing is not available yet. Choose Static, Reel, or Video to publish to @eric_sdesigns."
        : !instagramMediaReady
          ? "Instagram needs a public HTTPS link to one image or video. A Drive preview or private link may not be accessible to Meta."
          : "Ready for review. This will publish to @eric_sdesigns. Save as Scheduled, then choose Publish now from the queue when you are ready."
      : type !== "Static"
        ? "The Eric's Designs Facebook Page supports a text post with an optional webpage link. Choose Static; native carousel, photo, and video uploads are not available in this composer yet."
        : "This will publish to the Eric's Designs Facebook Page. Add an optional webpage link, save as Scheduled, then choose Publish now from the queue when you are ready.";
  const publishReady = isSignalPublishingClient && (platform === "Instagram" ? type !== "Carousel" && instagramMediaReady : type === "Static");
  const captionLimit = platform === "Instagram" ? 2200 : 5000;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (copy.length > captionLimit) { setError(`This ${platform} caption is over the ${captionLimit.toLocaleString()} character limit. Shorten it before saving.`); return; }
    setBusy(true); setError("");
    try { await save({ action: "save-post", post: { ...(post ? { id: post.id } : {}), clientId: selectedId, platform, title, copy, date: plannedDate, time, status, type, assetUrl, publishedUrl } }); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title={post ? "Edit post" : "Create a post"} description="Write a draft, request review, or schedule a publishing plan. Nothing is published automatically." onClose={onClose}><form onSubmit={event => void submit(event)}><div className="form-grid"><label>Client<select value={selectedId} disabled={!!post} onChange={e => { setSelectedId(e.target.value); setPlatform(eligible.find(c => c.id === e.target.value)!.channels[0].platform); }}>{eligible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Platform<select value={platform} onChange={e => setPlatform(e.target.value as Post["platform"])}>{client?.channels.map(c => <option key={c.platform}>{c.platform}</option>)}</select></label></div><label>Post title<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="Give the post a working title" /></label><div className="composer-caption-field"><label htmlFor="signal-post-caption">Caption <span className="caption-count">{copy.length}/{captionLimit}</span></label><textarea id="signal-post-caption" required rows={4} maxLength={captionLimit} value={copy} onChange={e => setCopy(e.target.value)} placeholder="Write your caption, hook, and call to action…" /><span className="field-help">{platform === "Instagram" ? "Instagram captions allow up to 2,200 characters." : "Keep it clear and easy to read on mobile."}</span></div><div className="form-grid"><label>Planned date (IST)<input type="date" required min="2000-01-01" max="2100-12-31" value={plannedDate} onChange={e => setDate(e.target.value)} /></label><label>Planned time (IST)<input type="time" required value={time} onChange={e => setTime(e.target.value)} /></label><label>Content type<select value={type} onChange={e => setType(e.target.value as Post["type"])}>{POST_TYPES.map(t => { const unsupported = (platform === "Instagram" && t === "Carousel") || (platform === "Facebook" && t !== "Static"); return <option key={t} disabled={unsupported}>{t}{unsupported ? " · planning only" : ""}</option>; })}</select></label><label>Status<select value={status} onChange={e => setStatus(e.target.value as Post["status"])}>{POST_STATUSES.filter(value => value !== "Publishing").map(s => <option key={s}>{s}</option>)}</select></label></div><label>{platform === "Instagram" ? "Public media URL" : "Optional webpage link"}<span className="optional">{platform === "Instagram" ? "required to publish · HTTPS image or video" : "Facebook post link · photo/video upload is not available"}</span><input type="url" value={assetUrl} onChange={e => setAssetUrl(e.target.value)} placeholder={platform === "Instagram" ? "https://your-site.com/image.jpg" : "https://your-site.com/page"} maxLength={2048} /></label><div className={`post-publish-guidance ${publishReady ? "ready" : "needs-attention"}`} role="status"><Info size={16} /><p><strong>{publishReady ? "Publishing details" : "Before publishing"}</strong><span>{publishGuidance}</span></p></div>{status === "Published" && <label>Live post URL<input type="url" required value={publishedUrl} onChange={e => setPublishedUrl(e.target.value)} placeholder="https://…" maxLength={2048} /><span className="optional">Manually records a post already published on the platform.</span></label>}<FormError error={error} /><div className="modal-footer"><span className="save-note">Asia/Kolkata · UTC+05:30</span><div className="inline-buttons">{post && <button type="button" className="button danger" disabled={busy} onClick={() => { if (window.confirm(`Delete “${post.title}”?`)) { setBusy(true); void save({ action: "delete-post", id: post.id }).then(onClose).catch(e => setError(errorMessage(e))).finally(() => setBusy(false)); } }}><Trash2 size={14} />Delete</button>}<button className="button primary" disabled={busy || !client}>{busy ? "Saving…" : post ? "Save post" : status === "Draft" ? "Save draft" : status === "Scheduled" ? "Save scheduled post" : status === "Needs review" ? "Send for review" : "Save post"}<Plus size={15} /></button></div></div></form></Modal>;
}

export function MetricForm({ clients, clientId, onClose, save }: { clients: Client[]; clientId: string; onClose: () => void; save: Save }) {
  const eligible = clients.filter(c => c.channels.length && !c.archived);
  const initial = eligible.find(c => c.id === clientId) ?? eligible[0];
  const [selectedId, setSelectedId] = useState(initial?.id ?? ""), [platform, setPlatform] = useState(initial?.channels[0]?.platform ?? "Instagram");
  const [date, setDate] = useState(todayInZone()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const client = eligible.find(c => c.id === selectedId);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try { await save({ action: "save-metric", metric: { clientId: selectedId, platform, date, reach: Number(form.get("reach")), engagements: Number(form.get("engagements")), followers: Number(form.get("followers")) } }); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title="Record daily metrics" description="Enter daily values from a platform report. Saving the same client, platform, and date replaces that day's values." onClose={onClose}><form onSubmit={event => void submit(event)}><div className="form-grid"><label>Client<select value={selectedId} onChange={e => { setSelectedId(e.target.value); setPlatform(eligible.find(c => c.id === e.target.value)!.channels[0].platform); }}>{eligible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Platform<select value={platform} onChange={e => setPlatform(e.target.value as Post["platform"])}>{client?.channels.map(c => <option key={c.platform}>{c.platform}</option>)}</select></label></div><label>Reporting date<input type="date" min="2000-01-01" max={todayInZone()} required value={date} onChange={e => setDate(e.target.value)} /></label><div className="form-grid">{["reach", "engagements", "followers"].map(field => <label key={field}>{field[0].toUpperCase() + field.slice(1)}<input type="number" name={field} min="0" max="1000000000000" step="1" required defaultValue="0" /></label>)}</div><FormError error={error} /><div className="modal-footer"><span className="save-note">Manual reporting · no live API sync</span><button className="button primary" disabled={busy || !client}>{busy ? "Saving…" : "Save metrics"}<Check size={15} /></button></div></form></Modal>;
}
