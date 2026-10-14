"use client";

import { useCallback, useEffect, useState } from "react";
import { Facebook, Instagram, LoaderCircle, MessageSquareText, RefreshCw, ShieldAlert } from "lucide-react";

type Page = { id: string; name: string; instagram?: { id: string; username: string } };
type Conversation = { id: string; platform: "Facebook" | "Instagram"; participant: string; participantId?: string; updatedAt: string; messages: { id: string; text: string; sender: string; createdAt: string }[] };
type Result = { pages: Page[]; connected: boolean; page?: { id: string; name: string }; conversations: Conversation[]; error?: string };

export function MetaInboxView() {
  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState("");
  const [platform, setPlatform] = useState<"messenger" | "instagram">("messenger");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (conversationId?: string) => {
    if (!pageId) return;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ pageId, platform, ...(conversationId ? { conversationId } : {}) });
      const response = await fetch(`/api/meta/inbox?${query}`, { cache: "no-store", credentials: "same-origin" });
      const data = await response.json() as Result;
      if (!response.ok) throw new Error(data.error || "Could not load this inbox.");
      setPages(data.pages ?? []);
      if (conversationId) setConversations(current => current.map(item => item.id === conversationId ? data.conversations[0] ?? item : item));
      else setConversations(data.conversations ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this inbox."); }
    finally { setBusy(false); }
  }, [pageId, platform]);

  useEffect(() => {
    let live = true;
    void fetch("/api/meta/status", { cache: "no-store", credentials: "same-origin" }).then(async response => {
      const data = await response.json() as Result;
      if (!response.ok) throw new Error(data.error || "Meta connection status could not be loaded.");
      if (live) { setPages(data.pages ?? []); setPageId(current => current || data.pages?.[0]?.id || ""); if (!data.connected) setError("Connect Meta in Settings to open the inbox."); }
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Meta connection status could not be loaded."); });
    return () => { live = false; };
  }, []);

  useEffect(() => { setSelected(""); setConversations([]); if (pageId) void load(); }, [pageId, platform, load]);
  useEffect(() => { if (pageId && platform === "instagram" && !pages.find(item => item.id === pageId)?.instagram) setPlatform("messenger"); }, [pageId, pages, platform]);
  const active = conversations.find(item => item.id === selected);
  const page = pages.find(item => item.id === pageId);
  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !draft.trim() || !pageId || sending) return;
    if (!window.confirm(`Send this reply to ${active.participant} on ${active.platform}?`)) return;
    setSending(true); setError("");
    try {
      const response = await fetch("/api/meta/inbox", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId, platform: platform, conversationId: active.id, text: draft.trim() }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Meta could not send this reply.");
      setDraft(""); await load(active.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Meta could not send this reply."); }
    finally { setSending(false); }
  }

  return <section className="meta-inbox" aria-label="Meta shared inbox">
    <div className="meta-inbox-toolbar"><div><span className="eyebrow">FACEBOOK & INSTAGRAM</span><h2>Shared inbox</h2><p>Conversations for the selected Page and linked Instagram account.</p></div><div className="meta-inbox-controls">
      <label className="ads-select"><span className="sr-only">Facebook Page</span><select aria-label="Facebook Page" value={pageId} onChange={event => setPageId(event.target.value)} disabled={!pages.length}>{pages.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <button type="button" className={`button ${platform === "messenger" ? "primary" : "secondary"}`} onClick={() => setPlatform("messenger")}><Facebook size={14} />Facebook</button>
      <button type="button" className={`button ${platform === "instagram" ? "primary" : "secondary"}`} onClick={() => setPlatform("instagram")} disabled={platform !== "instagram" && !!page && !page.instagram}><Instagram size={14} />Instagram</button>
      <button type="button" className="square-button" onClick={() => void load(selected || undefined)} disabled={busy || !pageId} aria-label="Refresh inbox">{busy ? <LoaderCircle size={15} className="social-spinning" /> : <RefreshCw size={14} />}</button>
    </div></div>
    {error && <div className="meta-inbox-error" role="alert"><ShieldAlert size={17} /><div><strong>Inbox access is not ready</strong><p>{error}</p><small>Reading messages needs `pages_messaging` for Facebook and `instagram_manage_messages` for Instagram, plus Page messaging access. Meta may also require app review for people outside the app roles.</small></div></div>}
    {!error && !pages.length && <div className="meta-inbox-error" role="status"><ShieldAlert size={17} /><div><strong>No Facebook Page access found</strong><p>Reconnect Meta in Settings and approve access to the Eric’s Designs Page before opening its messages.</p></div></div>}
    <div className="meta-inbox-grid"><div className="meta-inbox-list" aria-label="Conversations">
      {!busy && !error && conversations.length === 0 && <div className="meta-inbox-empty"><MessageSquareText size={22} /><strong>No conversations to show</strong><span>New or existing messages appear here when Meta returns them.</span></div>}
      {conversations.map(item => <button type="button" key={item.id} className={`meta-inbox-thread ${selected === item.id ? "selected" : ""}`} onClick={() => { setSelected(item.id); void load(item.id); }}><span className="meta-inbox-avatar">{platform === "instagram" ? <Instagram size={16} /> : <Facebook size={16} />}</span><span className="meta-inbox-thread-text"><strong>{item.participant}</strong><small>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "Conversation"}</small></span><span className="meta-inbox-platform">{item.platform}</span></button>)}
      {busy && !conversations.length && <div className="meta-inbox-loading"><LoaderCircle size={18} className="social-spinning" />Loading conversations…</div>}
    </div><div className="meta-inbox-detail">
      {!active && <div className="meta-inbox-empty"><MessageSquareText size={24} /><strong>Select a conversation</strong><span>Open a conversation to read messages and send a reply after confirmation.</span></div>}
      {active && <><div className="meta-inbox-detail-heading"><span className="meta-inbox-avatar">{active.platform === "Instagram" ? <Instagram size={16} /> : <Facebook size={16} />}</span><div><strong>{active.participant}</strong><small>{active.platform} · {page?.name}</small></div></div><div className="meta-inbox-messages">{busy && <div className="meta-inbox-loading"><LoaderCircle size={16} className="social-spinning" />Loading messages…</div>}{active.messages.map(message => <article className="meta-inbox-message" key={message.id}><strong>{message.sender}</strong><p>{message.text}</p><small>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ""}</small></article>)}{!busy && !active.messages.length && <p className="meta-inbox-no-messages">No text messages were returned for this conversation.</p>}</div><form className="meta-inbox-reply" onSubmit={event => void sendReply(event)}><label className="sr-only" htmlFor="meta-inbox-reply-text">Write a reply</label><textarea id="meta-inbox-reply-text" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder="Write a reply…" disabled={sending} /><button className="button primary" type="submit" disabled={sending || !draft.trim()}>{sending ? <LoaderCircle size={14} className="social-spinning" /> : null}Send reply</button></form><div className="meta-inbox-readonly">Replies are sent only after you confirm. Meta applies its messaging time window.</div></>}
    </div></div>
  </section>;
}
