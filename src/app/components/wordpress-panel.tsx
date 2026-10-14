"use client";
import { useEffect, useRef, useState } from "react";
import type { WordPressReceipt } from "@/lib/wordpress";

export function WordPressPanel({ siteUrl }: { siteUrl: string }) {
  const selectedSite = useRef(siteUrl); selectedSite.current = siteUrl;
  const [status, setStatus] = useState<{ configured: boolean; missing: string[]; siteUrl: string | null; error?: string }>();
  const [history, setHistory] = useState<WordPressReceipt[]>([]);
  const [preview, setPreview] = useState<WordPressReceipt>();
  const [type, setType] = useState("posts"); const [postId, setPostId] = useState("");
  const [title, setTitle] = useState(""); const [excerpt, setExcerpt] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setPreview(undefined); setHistory([]); setStatus(undefined); setError("");
    fetch(`/api/wordpress?siteUrl=${encodeURIComponent(siteUrl)}`, { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus(data); setHistory(data.history); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [siteUrl]);
  async function action(input: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/wordpress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, siteUrl }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (selectedSite.current !== siteUrl) return;
      const r = data.change as WordPressReceipt;
      setHistory(items => [r, ...items.filter(item => item.id !== r.id)]);
      setPreview(r.state === "preview" ? r : undefined);
    } catch (e) { if (selectedSite.current === siteUrl) setError(e instanceof Error ? e.message : "Request failed. Refresh history before retrying a write."); }
    finally { setBusy(false); }
  }
  return <section className="card live-panel wordpress-panel" aria-label="WordPress publishing">
    <h3>WordPress · approved native-field publishing</h3>
    <p className="body-copy">Updates only the native title and excerpt. For pages that do not support excerpts, leave excerpt empty to update the title only. SEO plugin metadata is not modified. Publication status is preserved. Every write requires a saved preview and explicit approval.</p>
    {error && <p role="alert">{error}</p>}
    {!status?.configured ? <p>Configure server-only WP_SITE_URL (public HTTPS origin), WP_USERNAME, and WP_APPLICATION_PASSWORD, then restart the server. {status?.missing?.length ? `Missing: ${status.missing.join(", ")}.` : status?.error}</p> : <>
      <p>Connected configuration: {status.siteUrl}</p>
      <fieldset disabled={busy}>
        <legend>Proposed exact fields</legend>
        <label>Resource <select value={type} onChange={e => { setType(e.target.value); setPreview(undefined); }}><option value="posts">Post</option><option value="pages">Page</option></select></label>
        <label>WordPress ID <input type="number" min="1" step="1" value={postId} onChange={e => { setPostId(e.target.value); setPreview(undefined); }} /></label>
        <label>Native title <input maxLength={200} value={title} onChange={e => { setTitle(e.target.value); setPreview(undefined); }} /></label>
        <label>Native excerpt <textarea maxLength={5000} value={excerpt} onChange={e => { setExcerpt(e.target.value); setPreview(undefined); }} /></label>
        <button type="button" onClick={() => action({ action: "preview", postId: Number(postId), type, title, excerpt })}>Preview existing vs proposed</button>
      </fieldset>
      {preview && <div><h4>Saved preview · {preview.type}/{preview.postId}</h4><p>Publication status: {preview.before.status}</p><table><thead><tr><th>Field</th><th>Existing (exact raw value)</th><th>Proposed (exact value)</th></tr></thead><tbody>{(["title", "excerpt"] as const).map(field => <tr key={field}><th>{field}</th><td><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(preview.before[field])}</pre></td><td><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(preview.after[field])}</pre></td></tr>)}</tbody></table><button disabled={busy} onClick={() => { if (window.confirm(`Approve writing this exact preview to ${preview.siteUrl} ${preview.type}/${preview.postId}?`)) void action({ action: "apply", changeId: preview.id, confirmed: true }); }}>Approve and apply exact preview</button></div>}
      <h4>Saved history (latest 100)</h4>
      <button disabled={busy} onClick={async () => { setBusy(true); try { const response = await fetch(`/api/wordpress?siteUrl=${encodeURIComponent(siteUrl)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setHistory(data.history); } catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); } finally { setBusy(false); } }}>Refresh history</button>
      {!history.length && <p>No saved changes for this website.</p>}
      <ul>{history.map(r => <li key={r.id}><strong>{r.type}/{r.postId} · {r.state}</strong> · {r.created}<p>{r.message}</p><details><summary>Receipt and exact fields</summary><p>{r.id}</p><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify({ before: r.before, proposed: r.after, verified: r.applied }, null, 2)}</pre></details>{r.state === "preview" && <button disabled={busy} onClick={() => setPreview(r)}>Review saved preview</button>}{r.state === "applied" && <button disabled={busy} onClick={() => { if (window.confirm(`Restore the original title and excerpt for ${r.type}/${r.postId}? This is allowed only if WordPress still matches the applied snapshot.`)) void action({ action: "rollback", changeId: r.id, confirmed: true }); }}>Confirm rollback…</button>}{r.state === "uncertain" && <button disabled={busy} onClick={() => action({ action: "reconcile", changeId: r.id })}>Reconcile by reading (no write)</button>}</li>)}</ul>
    </>}
  </section>;
}
