"use client";

import { useEffect, useRef } from "react";
import { Check, Facebook, Instagram, Linkedin, Music2, Pin, X, Youtube } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Client, Platform, PostStatus } from "@/lib/social-workspace";

const icons: Record<Platform, LucideIcon> = { Instagram, Facebook, LinkedIn: Linkedin, YouTube: Youtube, TikTok: Music2, X, Pinterest: Pin };
export function PlatformIcon({ platform, size = 14 }: { platform: Platform; size?: number }) {
  const Icon = icons[platform];
  return <span className={`platform-icon ${platform.toLowerCase()}`} title={platform}><Icon size={size} /></span>;
}
export function ClientAvatar({ client, size = "medium" }: { client: Client; size?: "small" | "medium" | "large" }) {
  return <span className={`client-avatar ${size}`} style={{ background: client.color, color: client.accent }}>{client.initials}</span>;
}
export function StatusChip({ status }: { status: PostStatus }) {
  return <span className={`status-chip ${status.toLowerCase().replaceAll(" ", "-")}`}><span className="status-dot" />{status}</span>;
}
export function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]");
    controls()?.[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handle(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const elements = controls();
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handle);
    return () => { document.removeEventListener("keydown", handle); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-layer" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card composer-modal" role="dialog" aria-modal="true" aria-labelledby="signal-dialog-title" ref={ref}><div className="modal-heading"><div><span className="eyebrow">SIGNAL WORKSPACE</span><h2 id="signal-dialog-title">{title}</h2><p>{description}</p></div><button className="close-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>{children}</div></div>;
}
export function FormError({ error }: { error: string }) { return error ? <p className="social-form-error" role="alert">{error}</p> : null; }
export function EmptyState({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <div className="empty-queue"><span className="empty-state-mark">✦</span><strong>{title}</strong><span>{description}</span>{children}</div>;
}
export function DownloadButton({ label, onClick }: { label: string; onClick: () => void }) { return <button className="text-button" onClick={onClick}>{label} <Check size={13} /></button>; }
export function downloadFile(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const shortNumber = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request failed. Please try again.";

export function ReachChart({ days }: { days: { date: string; reach: number; engagements: number }[] }) {
  const max = Math.max(1, ...days.map(day => day.reach));
  const ticks = Array.from({ length: 5 }, (_, index) => shortNumber(max * (4 - index) / 4));
  const labels = [0, Math.floor(days.length / 3), Math.floor(days.length * 2 / 3), days.length - 1];
  return <div className="bar-chart" role="img" aria-label={`Daily reach chart; ${days.length} days. Maximum reach ${max}.`}><div className="chart-y-labels">{ticks.map((tick, index) => <span key={index}>{tick}</span>)}</div><div className="chart-bars">{days.map(day => <div key={day.date} className="chart-bar-wrap" title={`${day.date}: ${day.reach.toLocaleString()} reach, ${day.engagements.toLocaleString()} engagements`}><div className="chart-bar real-reach" style={{ height: `${day.reach / max * 100}%`, minHeight: day.reach ? 3 : 0 }} /></div>)}</div><div className="chart-x-labels">{labels.map((index, i) => <span key={i}>{days[index]?.date.slice(5).replace("-", "/")}</span>)}</div></div>;
}
