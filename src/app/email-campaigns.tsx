"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, Mail, RefreshCw, Sparkles } from "lucide-react";
import type { Client } from "@/lib/social-workspace";
import {
  createDefaultCampaignBrief,
  EMAIL_OBJECTIVES,
  EMAIL_TONES,
  generateEmailCampaign,
  type CampaignLength,
  type EmailCampaignBrief,
  type EmailObjective,
  type EmailTone,
  type GeneratedCampaignEmail,
  validateEmailCampaignBrief,
} from "@/lib/email-campaign";
import { downloadFile, FormError } from "./social-ui";

const objectiveDescriptions: Record<EmailObjective, string> = {
  "Book more consultations": "Turn interest into a focused conversation.",
  "Re-engage past customers": "Bring a warm relationship back to life.",
  "Launch a new offer": "Introduce something timely and easy to understand.",
  "Share a useful resource": "Lead with value before asking for time.",
};

const toneDescriptions: Record<EmailTone, string> = {
  "Warm & consultative": "Human, curious, and low pressure.",
  "Direct & confident": "Clear, concise, and action-oriented.",
  "Playful & energetic": "Bright, conversational, and memorable.",
  "Thoughtful & premium": "Considered, calm, and high-touch.",
};

const sequenceOptions: CampaignLength[] = [1, 3, 5];

function initialBrief(clients: Client[], selectedId: string): { brief: EmailCampaignBrief; clientId: string } {
  const client = clients.find(item => item.id === selectedId) ?? clients[0];
  return { brief: createDefaultCampaignBrief(client?.name), clientId: client?.id ?? "custom" };
}

function campaignText(emails: GeneratedCampaignEmail[]): string {
  return emails.map(email => `EMAIL ${email.step} · ${email.delay} · ${email.label}\nSubject: ${email.subject}\nPreview: ${email.preview}\n\n${email.body}`).join("\n\n────────────────────────\n\n");
}

function filename(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return safe || "email-campaign";
}

export function EmailCampaignsView({ clients, selectedId }: { clients: Client[]; selectedId: string }) {
  const initial = initialBrief(clients, selectedId);
  const [brief, setBrief] = useState<EmailCampaignBrief>(initial.brief);
  const [clientId, setClientId] = useState(initial.clientId);
  const [generated, setGenerated] = useState<GeneratedCampaignEmail[]>(() => generateEmailCampaign(initial.brief));
  const [selectedEmail, setSelectedEmail] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (clientId === "custom") return;
    const client = clients.find(item => item.id === clientId);
    if (client && client.name !== brief.brandName) setBrief(previous => ({ ...previous, brandName: client.name }));
  }, [brief.brandName, clientId, clients]);

  function updateBrief<K extends keyof EmailCampaignBrief>(field: K, value: EmailCampaignBrief[K]) {
    setBrief(previous => ({ ...previous, [field]: value }));
    setError("");
  }

  function updateRecipient(field: keyof EmailCampaignBrief["recipient"], value: string) {
    setBrief(previous => ({ ...previous, recipient: { ...previous.recipient, [field]: value } }));
    setError("");
  }

  function updatePersonalization(field: keyof EmailCampaignBrief["personalization"], value: boolean) {
    setBrief(previous => ({ ...previous, personalization: { ...previous.personalization, [field]: value } }));
  }

  function chooseClient(value: string) {
    setClientId(value);
    const client = clients.find(item => item.id === value);
    updateBrief("brandName", client?.name ?? "Your brand");
  }

  function generate() {
    const errors = validateEmailCampaignBrief(brief);
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    const next = generateEmailCampaign(brief);
    setGenerated(next);
    setSelectedEmail(0);
    setNotice(`${next.length}-email sequence generated and ready to refine.`);
  }

  function reset() {
    const next = createDefaultCampaignBrief(clientId === "custom" ? "Your brand" : clients.find(client => client.id === clientId)?.name);
    setBrief(next);
    setGenerated(generateEmailCampaign(next));
    setSelectedEmail(0);
    setError("");
    setNotice("Brief reset to a fresh starting point.");
  }

  function updateEmail(field: "subject" | "preview" | "body", value: string) {
    setGenerated(previous => previous.map((email, index) => index === selectedEmail ? { ...email, [field]: value } : email));
  }

  async function copyCurrent() {
    const email = generated[selectedEmail];
    if (!email) return;
    const content = `Subject: ${email.subject}\nPreview: ${email.preview}\n\n${email.body}`;
    try {
      await navigator.clipboard.writeText(content);
      setNotice("Email copied to your clipboard.");
    } catch {
      downloadFile(`${filename(brief.campaignName)}-email-${email.step}.txt`, content, "text/plain;charset=utf-8");
      setNotice("Clipboard access was unavailable, so the email was downloaded instead.");
    }
  }

  function exportCampaign() {
    downloadFile(`${filename(brief.campaignName)}.txt`, campaignText(generated), "text/plain;charset=utf-8");
    setNotice("Campaign sequence downloaded as a text file.");
  }

  const email = generated[selectedEmail];
  const personalizationCount = Object.values(brief.personalization).filter(Boolean).length;

  return <section className="campaigns-view">
    <div className="campaigns-toolbar">
      <div>
        <span className="eyebrow">PERSONALIZED DRAFTING STUDIO</span>
        <h2>Make every message feel considered.</h2>
        <p>Give the sequence a little context, then refine the drafts before you export them to your sending platform.</p>
      </div>
      <div className="campaign-toolbar-actions">
        <button type="button" className="button secondary" onClick={reset}><RefreshCw size={14} />Start over</button>
        <button type="button" className="button primary" onClick={generate}><Sparkles size={15} />Generate sequence</button>
      </div>
    </div>

    {notice && <div className="campaign-notice" role="status"><Check size={15} />{notice}</div>}
    <FormError error={error} />

    <div className="campaign-workspace">
      <aside className="panel campaign-brief-panel">
        <div className="campaign-panel-heading"><div><span className="eyebrow">01 · CAMPAIGN BRIEF</span><h3>Start with the why</h3></div><span className="campaign-step-mark">1</span></div>
        <div className="campaign-form">
          <label>Client or brand<select value={clientId} onChange={event => chooseClient(event.target.value)}><option value="custom">Use a new brand</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          {clientId === "custom" && <label>Brand name<input value={brief.brandName} onChange={event => updateBrief("brandName", event.target.value)} maxLength={80} placeholder="Your brand name" /></label>}
          <label>Campaign name<input value={brief.campaignName} onChange={event => updateBrief("campaignName", event.target.value)} maxLength={120} placeholder="Give this sequence a clear name" /></label>
          <label>Audience<textarea value={brief.audience} onChange={event => updateBrief("audience", event.target.value)} rows={2} maxLength={240} placeholder="Who is this for?" /></label>
          <label>Offer or hook<input value={brief.offer} onChange={event => updateBrief("offer", event.target.value)} maxLength={240} placeholder="What are you offering?" /></label>
          <label>Context to reference<textarea value={brief.context} onChange={event => updateBrief("context", event.target.value)} rows={3} maxLength={400} placeholder="What should make this feel relevant?" /></label>
          <label>Call to action<input value={brief.callToAction} onChange={event => updateBrief("callToAction", event.target.value)} maxLength={120} placeholder="What should they do next?" /></label>
          <div className="form-grid">
            <label>Sender name<input value={brief.senderName} onChange={event => updateBrief("senderName", event.target.value)} maxLength={80} /></label>
            <label>Sequence length<select value={brief.sequenceLength} onChange={event => updateBrief("sequenceLength", Number(event.target.value) as CampaignLength)}>{sequenceOptions.map(length => <option value={length} key={length}>{length} email{length === 1 ? "" : "s"}</option>)}</select></label>
          </div>
        </div>

        <div className="campaign-subsection">
          <span className="campaign-label">CAMPAIGN GOAL</span>
          <div className="campaign-option-grid">{EMAIL_OBJECTIVES.map(objective => <button type="button" className={`campaign-option ${brief.objective === objective ? "selected" : ""}`} aria-pressed={brief.objective === objective} key={objective} onClick={() => updateBrief("objective", objective)}><strong>{objective}</strong><small>{objectiveDescriptions[objective]}</small></button>)}</div>
        </div>

        <div className="campaign-subsection">
          <span className="campaign-label">VOICE</span>
          <div className="campaign-tone-row">{EMAIL_TONES.map(tone => <button type="button" className={`campaign-tone ${brief.tone === tone ? "selected" : ""}`} aria-pressed={brief.tone === tone} key={tone} onClick={() => updateBrief("tone", tone)}>{tone}</button>)}</div>
          <p className="campaign-helper">{toneDescriptions[brief.tone]}</p>
        </div>
      </aside>

      <div className="campaign-main-column">
        <section className="panel recipient-panel">
          <div className="campaign-panel-heading"><div><span className="eyebrow">02 · PERSONALIZATION</span><h3>Preview it for one real person</h3></div><span className="campaign-token-count"><Sparkles size={13} />{personalizationCount} fields on</span></div>
          <p className="campaign-panel-copy">Use a representative contact to make sure the copy sounds natural before you roll it out to a list.</p>
          <div className="recipient-fields"><label>First name<input value={brief.recipient.firstName} onChange={event => updateRecipient("firstName", event.target.value)} placeholder="Alex" /></label><label>Company<input value={brief.recipient.company} onChange={event => updateRecipient("company", event.target.value)} placeholder="Northstar Co." /></label><label>Role<input value={brief.recipient.role} onChange={event => updateRecipient("role", event.target.value)} placeholder="Founder" /></label><label>Pain point<input value={brief.recipient.painPoint} onChange={event => updateRecipient("painPoint", event.target.value)} placeholder="Their current challenge" /></label></div>
          <div className="campaign-token-row"><span className="campaign-label">PERSONALIZE WITH</span>{(["firstName", "company", "role", "painPoint"] as const).map(field => <label className="campaign-token" key={field}><input type="checkbox" checked={brief.personalization[field]} onChange={event => updatePersonalization(field, event.target.checked)} /><span>{field === "firstName" ? "First name" : field === "painPoint" ? "Pain point" : field[0].toUpperCase() + field.slice(1)}</span></label>)}</div>
        </section>

        <section className="panel campaign-preview-panel">
          <div className="campaign-preview-heading"><div><span className="eyebrow">03 · GENERATED SEQUENCE</span><h3>{brief.campaignName || "Untitled campaign"}</h3><p>{brief.brandName || "Your brand"} · {brief.tone} · {generated.length} email{generated.length === 1 ? "" : "s"}</p></div><div className="campaign-preview-actions"><button type="button" className="button secondary" onClick={exportCampaign} disabled={!generated.length}><Download size={14} />Export all</button><button type="button" className="button secondary" onClick={() => void copyCurrent()} disabled={!email}><Copy size={14} />Copy email</button></div></div>
          <div className="campaign-email-tabs" role="tablist" aria-label="Generated campaign emails">{generated.map((item, index) => <button type="button" role="tab" aria-selected={selectedEmail === index} className={`campaign-email-tab ${selectedEmail === index ? "selected" : ""}`} key={item.id} onClick={() => setSelectedEmail(index)}><span className="campaign-email-number">0{item.step}</span><span><strong>{item.label}</strong><small>{item.delay} · {item.subject}</small></span></button>)}</div>
          {email ? <div className="campaign-editor">
            <div className="campaign-editor-meta"><span className="campaign-email-badge"><Mail size={14} />Email {email.step}</span><span className="campaign-delay">Send {email.delay.toLowerCase()}</span><span className="campaign-live-preview"><span />Live sample · {brief.recipient.firstName || "there"}{brief.recipient.company ? ` at ${brief.recipient.company}` : ""}</span></div>
            <label>Subject line<input value={email.subject} onChange={event => updateEmail("subject", event.target.value)} maxLength={160} /></label>
            <label>Preview text<input value={email.preview} onChange={event => updateEmail("preview", event.target.value)} maxLength={200} /></label>
            <label>Email body<textarea className="campaign-body-editor" value={email.body} onChange={event => updateEmail("body", event.target.value)} rows={13} /></label>
            <div className="campaign-editor-footer"><span><span className="footer-dot" />Editable draft · Nothing sends automatically</span><button type="button" className="text-button" onClick={() => setNotice("Keep refining this draft, then export the sequence when it is ready.")}>How to use this <Sparkles size={13} /></button></div>
          </div> : <div className="campaign-empty"><Mail size={24} /><strong>Your sequence will appear here</strong><span>Complete the brief and generate a fresh campaign.</span></div>}
        </section>
      </div>
    </div>
  </section>;
}
