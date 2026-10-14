"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AccessForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Sign-in failed.");
      router.replace(nextPath); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  return <main className="access-page"><section className="access-card"><div className="access-mark">S</div><h1>SEO Command Center</h1><p>Enter your workspace password to continue.</p><form className="access-form" onSubmit={submit}><label htmlFor="access-password">Workspace password</label><input id="access-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={16} maxLength={256} /><button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form>{error && <p className="access-error" role="alert">{error}</p>}</section></main>;
}
