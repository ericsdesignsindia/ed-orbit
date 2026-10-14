"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BarChart3, CircleAlert, Download, LoaderCircle, Megaphone, MousePointerClick, RefreshCw, WalletCards } from "lucide-react";
import { csvText } from "@/lib/social-workspace";
import { downloadFile } from "./social-ui";

type Account = { id: string; accountId: string; name: string; currency: string; timezone: string; status: number };
type Campaign = { id: string; name: string; status: string; effectiveStatus: string; objective: string; spend: number; impressions: number; reach: number; clicks: number; ctr: number; cpc: number; cpm: number };
type AdsResponse = { accounts?: Account[]; account?: Account; campaigns?: Campaign[] | null; datePreset?: string; error?: string };
const periods = [{ value: "last_7d", label: "Last 7 days" }, { value: "last_30d", label: "Last 30 days" }, { value: "last_90d", label: "Last 90 days" }] as const;
const count = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);

export function MetaAdsView() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [period, setPeriod] = useState<(typeof periods)[number]["value"]>("last_30d");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [needsAdsPermission, setNeedsAdsPermission] = useState(false);
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [objective, setObjective] = useState("OUTCOME_TRAFFIC");
  const [savingCampaign, setSavingCampaign] = useState(false);

  const loadAccounts = useCallback(async () => {
    setBusy(true); setError(""); setNeedsAdsPermission(false);
    try {
      const response = await fetch("/api/meta/ads", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await response.json() as AdsResponse;
      if (!response.ok) {
        if (response.status === 401) { setConnected(false); throw new Error(data.error || "Connect Meta to see your ad accounts."); }
        setNeedsAdsPermission(response.status === 400 || response.status === 403);
        throw new Error(data.error || "Meta Ads data could not be loaded.");
      }
      setConnected(true); setAccounts(data.accounts ?? []);
      const next = accountId && (data.accounts ?? []).some(item => item.id === accountId) ? accountId : data.accounts?.[0]?.id ?? "";
      setAccountId(next);
      if (!next) setCampaigns([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Meta Ads data could not be loaded."); }
    finally { setBusy(false); }
  }, [accountId]);

  const loadCampaigns = useCallback(async (selected: string, selectedPeriod: string) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ accountId: selected, datePreset: selectedPeriod });
      const response = await fetch(`/api/meta/ads?${query}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await response.json() as AdsResponse;
      if (!response.ok) { setNeedsAdsPermission(response.status === 400 || response.status === 403); throw new Error(data.error || "Campaign results could not be loaded."); }
      setAccounts(data.accounts ?? []); setCampaigns(data.campaigns ?? []); setConnected(true);
    } catch (cause) { setCampaigns(null); setError(cause instanceof Error ? cause.message : "Campaign results could not be loaded."); }
    finally { setBusy(false); }
  }, []);

  const saveCampaign = async (input: { accountId: string; name: string; objective?: string; campaignId?: string; status?: "ACTIVE" | "PAUSED" }) => {
    setSavingCampaign(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/meta/ads", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(input) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setNeedsAdsPermission(response.status === 400 || response.status === 403); throw new Error(data.error || "Meta could not save the campaign."); }
      setCreateOpen(false); setEditCampaign(null); setNotice(input.campaignId ? "Campaign settings updated." : "Campaign created in paused state.");
      await loadCampaigns(input.accountId, period);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Meta could not save the campaign."); }
    finally { setSavingCampaign(false); }
  };

  const changeDelivery = (campaign: Campaign) => {
    const status = campaign.effectiveStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const action = status === "ACTIVE" ? "resume delivery" : "pause delivery";
    if (!window.confirm(`Are you sure you want to ${action} for “${campaign.name}”? Resuming an active campaign can spend its configured budget.`)) return;
    void saveCampaign({ accountId, campaignId: campaign.id, name: campaign.name, status });
  };

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (connected && accountId) void loadCampaigns(accountId, period); }, [connected, accountId, period, loadCampaigns]);

  const selectedAccount = accounts.find(item => item.id === accountId);
  const totals = useMemo(() => (campaigns ?? []).reduce((all, item) => ({ spend: all.spend + item.spend, impressions: all.impressions + item.impressions, reach: all.reach + item.reach, clicks: all.clicks + item.clicks }), { spend: 0, impressions: 0, reach: 0, clicks: 0 }), [campaigns]);
  const currency = (value: number) => new Intl.NumberFormat("en", { style: "currency", currency: selectedAccount?.currency ?? "USD", maximumFractionDigits: 2 }).format(value);
  const exportCampaigns = () => {
    if (!campaigns?.length) return;
    downloadFile(`meta-ads-${selectedAccount?.accountId ?? "account"}-${period}.csv`, csvText([["Campaign", "Objective", "Delivery", "Spend", "Currency", "Impressions", "Reach", "Clicks", "CTR", "CPC", "CPM"], ...campaigns.map(item => [item.name, item.objective, item.effectiveStatus, item.spend, selectedAccount?.currency ?? "USD", item.impressions, item.reach, item.clicks, item.ctr, item.cpc, item.cpm])]), "text/csv;charset=utf-8");
  };
  const campaignStatus = (status: string) => status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

  return <div className="ads-workspace">
    <div className="ads-toolbar">
      <div className="ads-context"><span className="ads-live-dot" />{connected ? "Connected to Meta Ads" : "Meta Ads connection"}{selectedAccount && <><span className="ads-context-divider">·</span>{selectedAccount.name}</>}</div>
      <div className="ads-actions">
        <label className="ads-select"><span className="sr-only">Ad account</span><select value={accountId} onChange={event => { setAccountId(event.target.value); setCampaigns(null); }} disabled={!accounts.length}><option value="">Choose ad account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
        <label className="ads-select"><span className="sr-only">Reporting period</span><select value={period} onChange={event => setPeriod(event.target.value as typeof period)}>{periods.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <button className="button secondary" type="button" onClick={() => void loadAccounts()} disabled={busy} aria-label="Refresh ad data">{busy ? <LoaderCircle size={15} className="social-spinning" /> : <RefreshCw size={15} />}<span>Refresh</span></button>
        <button className="button secondary" type="button" onClick={exportCampaigns} disabled={!campaigns?.length}><Download size={15} /><span>Export</span></button>
        <button className="button primary" type="button" onClick={() => { setCampaignName(""); setObjective("OUTCOME_TRAFFIC"); setCreateOpen(true); }} disabled={!connected || !accountId}><Megaphone size={15} /><span>New campaign</span></button>
      </div>
    </div>
    {notice && <div className="ads-success" role="status">{notice}</div>}
    {error && <div className="ads-notice" role="alert"><CircleAlert size={17} /><div><strong>{needsAdsPermission ? "Ads access needs to be enabled" : "Could not load Meta Ads"}</strong><p>{needsAdsPermission ? "Add ads_read for reporting and ads_management for campaign controls to the Signal Social Dashboard login configuration in Meta, then reconnect your account here." : error}</p>{needsAdsPermission && <a className="text-button" href="/api/meta/connect">Reconnect Meta account <ArrowUpRight size={14} /></a>}{!needsAdsPermission && !connected && <a className="button primary ads-connect-cta" href="/api/meta/connect">Connect Meta account <ArrowUpRight size={14} /></a>}</div></div>}
    {connected && !busy && !error && !accounts.length && <div className="ads-notice"><CircleAlert size={17} /><div><strong>No ad accounts found</strong><p>The connected Meta profile has no ad accounts available. Check its Business access in Meta Ads Manager.</p></div></div>}
    {connected && accounts.length > 0 && <>
      <section className="ads-summary-grid" aria-label="Ad performance summary">
        <article className="ads-summary-card"><span className="ads-summary-icon lime"><WalletCards size={17} /></span><span className="ads-summary-label">Amount spent</span><strong>{campaigns ? currency(totals.spend) : "—"}</strong><small>{selectedAccount?.currency ?? ""} · {periods.find(item => item.value === period)?.label}</small></article>
        <article className="ads-summary-card"><span className="ads-summary-icon lilac"><BarChart3 size={17} /></span><span className="ads-summary-label">Impressions</span><strong>{campaigns ? count(totals.impressions) : "—"}</strong><small>Across campaigns in this account</small></article>
        <article className="ads-summary-card"><span className="ads-summary-icon peach"><MousePointerClick size={17} /></span><span className="ads-summary-label">Link clicks</span><strong>{campaigns ? count(totals.clicks) : "—"}</strong><small>{totals.impressions ? `${(totals.clicks / totals.impressions * 100).toFixed(2)}% click-through rate` : "No click data in this period"}</small></article>
        <article className="ads-summary-card"><span className="ads-summary-icon blue"><Megaphone size={17} /></span><span className="ads-summary-label">Campaigns</span><strong>{campaigns ? count(campaigns.length) : "—"}</strong><small>In the selected ad account</small></article>
      </section>
      <section className="panel ads-campaign-panel"><div className="panel-heading"><div><span className="eyebrow">META ADS MANAGER · {periods.find(item => item.value === period)?.label.toUpperCase()}</span><h2>Campaign performance</h2></div><span className="ads-report-currency">{selectedAccount?.currency} · {selectedAccount?.timezone}</span></div>
        {busy && <div className="ads-loading"><LoaderCircle size={20} className="social-spinning" />Loading campaign results…</div>}
        {!busy && campaigns && campaigns.length === 0 && <div className="ads-empty"><Megaphone size={22} /><strong>No campaigns in this ad account</strong><span>Campaigns will appear here when Meta returns them.</span></div>}
        {!busy && !!campaigns?.length && <div className="ads-table-scroll"><table className="ads-table"><thead><tr><th>Campaign</th><th>Delivery</th><th>Objective</th><th>Amount spent</th><th>Impressions</th><th>Reach</th><th>Clicks</th><th>CTR</th><th>Cost / click</th><th>Controls</th></tr></thead><tbody>{campaigns.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>ID {item.id}</small></td><td><span className={`ads-status ${item.effectiveStatus.toLowerCase() === "active" ? "active" : ""}`}><i />{campaignStatus(item.effectiveStatus)}</span></td><td>{campaignStatus(item.objective)}</td><td>{currency(item.spend)}</td><td>{count(item.impressions)}</td><td>{count(item.reach)}</td><td>{count(item.clicks)}</td><td>{item.ctr.toFixed(2)}%</td><td>{currency(item.cpc)}</td><td><div className="ads-row-controls"><button type="button" className="text-button" onClick={() => { setEditCampaign(item); setCampaignName(item.name); }}>Edit</button><button type="button" className="text-button" onClick={() => changeDelivery(item)}>{item.effectiveStatus === "ACTIVE" ? "Pause" : "Resume"}</button></div></td></tr>)}</tbody></table></div>}
        <div className="ads-footnote">Campaigns created here start paused. Resuming an active campaign can spend its configured budget; Signal asks you to confirm before changing delivery.</div>
      </section>
    </>}
    {(createOpen || editCampaign) && <div className="ads-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !savingCampaign) { setCreateOpen(false); setEditCampaign(null); } }}><form className="ads-modal" role="dialog" aria-modal="true" aria-labelledby="ads-modal-title" onSubmit={event => { event.preventDefault(); if (!accountId || !campaignName.trim()) return; if (editCampaign) void saveCampaign({ accountId, campaignId: editCampaign.id, name: campaignName.trim(), status: editCampaign.status === "ACTIVE" ? "ACTIVE" : "PAUSED" }); else void saveCampaign({ accountId, name: campaignName.trim(), objective }); }}>
      <span className="eyebrow">{editCampaign ? "CAMPAIGN SETTINGS" : "NEW META CAMPAIGN"}</span><h2 id="ads-modal-title">{editCampaign ? "Edit campaign" : "Create a campaign"}</h2><p>{editCampaign ? "Change the campaign name. Delivery changes are confirmed separately." : "Signal creates the campaign paused, so it cannot spend until you add ad sets and ads and choose to resume it."}</p>
      <label>Campaign name<input autoFocus maxLength={200} required value={campaignName} onChange={event => setCampaignName(event.target.value)} placeholder="e.g. October lead generation" /></label>
      {!editCampaign && <label>Objective<select value={objective} onChange={event => setObjective(event.target.value)}><option value="OUTCOME_TRAFFIC">Traffic</option><option value="OUTCOME_LEADS">Leads</option><option value="OUTCOME_SALES">Sales</option><option value="OUTCOME_AWARENESS">Awareness</option><option value="OUTCOME_ENGAGEMENT">Engagement</option><option value="OUTCOME_APP_PROMOTION">App promotion</option></select></label>}
      <div className="ads-modal-actions"><button type="button" className="button secondary" onClick={() => { setCreateOpen(false); setEditCampaign(null); }} disabled={savingCampaign}>Cancel</button><button type="submit" className="button primary" disabled={savingCampaign || !campaignName.trim()}>{savingCampaign ? <LoaderCircle size={15} className="social-spinning" /> : null}{editCampaign ? "Save changes" : "Create paused campaign"}</button></div>
    </form></div>}
  </div>;
}
