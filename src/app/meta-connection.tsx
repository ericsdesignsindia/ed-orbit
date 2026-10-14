"use client";

import { useCallback, useEffect, useState } from "react";
import { Facebook, Instagram, LoaderCircle, RefreshCw, Unplug } from "lucide-react";

type MetaPage = { id: string; name: string; instagram?: { id: string; username: string } };
type MetaStatus = { configured: boolean; missing: string[]; connected: boolean; pages: MetaPage[]; expiresAt?: number; error?: string; reconnectNeeded?: boolean };

export function MetaConnection() {
  const [state, setState] = useState<MetaStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/meta/status", { cache: "no-store", credentials: "same-origin" });
      const data = await response.json() as MetaStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || "Meta connection status could not be loaded.");
      setState(data); if (data.error) setError(data.error);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Meta connection status could not be loaded."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function connect() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/social/session", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !data.authorizationUrl) throw new Error(data.error || "Meta authorization could not be started.");
      window.location.assign(data.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Meta authorization could not be started.");
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect Facebook and Instagram from Signal? Saved plans and reports will remain.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/meta/disconnect", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Meta could not be disconnected.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Meta could not be disconnected."); }
    finally { setBusy(false); }
  }
  return <section className="meta-connect-card" aria-label="Meta account connection">
    <div className="meta-connect-heading"><span className="meta-connect-mark"><Facebook size={17} /><Instagram size={15} /></span><div><strong>Facebook & Instagram</strong><small>{state?.connected ? "Connected to Signal" : state?.configured ? "Account connection" : "Setup required"}</small></div><button type="button" className="square-button" onClick={() => void load()} disabled={busy} aria-label="Refresh Meta connection">{busy ? <LoaderCircle size={15} className="social-spinning" /> : <RefreshCw size={14} />}</button></div>
    {!state && !error && <p className="meta-connect-copy">Checking Meta setup…</p>}
    {state && !state.configured && <><p className="meta-connect-copy">Add the Meta app credentials and the Signal redirect URL to finish setup. Credentials are stored server-side in Vercel.</p><div className="meta-setup-details"><span>Missing settings</span><strong>{state.missing.join(", ")}</strong><span>Meta callback URL</span><strong>https://seo-command-center-six.vercel.app/api/meta/callback</strong></div></>}
    {state?.configured && !state.connected && <><p className="meta-connect-copy">Connect the Facebook account that manages your Pages. Instagram must be a Business or Creator profile linked to a Page.</p><button type="button" className="button primary meta-connect-button" onClick={() => void connect()} disabled={busy}>{busy ? <LoaderCircle size={15} className="social-spinning" /> : <Facebook size={15} />}Connect Meta account</button></>}
    {state?.connected && <><p className="meta-connect-copy">Meta connection is encrypted in Signal. Reconnect to request newly added Page and Instagram messaging access.</p><div className="meta-page-list">{state.pages.map(page => <div className="meta-page-row" key={page.id}><span className="meta-page-icon"><Facebook size={15} /></span><span><strong>{page.name}</strong><small>Facebook Page</small></span>{page.instagram && <span className="meta-instagram-chip"><Instagram size={13} />@{page.instagram.username}</span>}</div>)}{!state.pages.length && <p className="meta-empty-pages">Connected, but no managed Facebook Pages were returned. Check that your Facebook profile has Page access.</p>}</div><div className="meta-connect-actions"><button type="button" className="button primary meta-connect-button" onClick={() => void connect()} disabled={busy}>{busy ? <LoaderCircle size={15} className="social-spinning" /> : <RefreshCw size={15} />}Reconnect with updated access</button><button type="button" className="button secondary meta-disconnect-button" onClick={() => void disconnect()} disabled={busy}><Unplug size={14} />Disconnect Meta</button></div></>}
    {error && <p className="meta-connect-error" role="alert">{error}</p>}
    <p className="meta-connect-footnote">Signal uses only Eric's Designs and @eric_sdesigns for Meta publishing and insight sync. Publishing always requires a separate confirmation; scheduled posts never publish automatically.</p>
  </section>;
}
