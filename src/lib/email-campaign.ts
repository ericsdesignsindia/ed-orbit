export const EMAIL_OBJECTIVES = [
  "Book more consultations",
  "Re-engage past customers",
  "Launch a new offer",
  "Share a useful resource",
] as const;
export type EmailObjective = typeof EMAIL_OBJECTIVES[number];

export const EMAIL_TONES = [
  "Warm & consultative",
  "Direct & confident",
  "Playful & energetic",
  "Thoughtful & premium",
] as const;
export type EmailTone = typeof EMAIL_TONES[number];

export type CampaignLength = 1 | 3 | 5;
export type PersonalizationSettings = {
  firstName: boolean;
  company: boolean;
  role: boolean;
  painPoint: boolean;
};
export type CampaignRecipient = {
  firstName: string;
  company: string;
  role: string;
  painPoint: string;
};
export type EmailCampaignBrief = {
  campaignName: string;
  brandName: string;
  senderName: string;
  objective: EmailObjective;
  audience: string;
  tone: EmailTone;
  offer: string;
  context: string;
  callToAction: string;
  sequenceLength: CampaignLength;
  personalization: PersonalizationSettings;
  recipient: CampaignRecipient;
};
export type GeneratedCampaignEmail = {
  id: string;
  step: number;
  delay: string;
  label: string;
  subject: string;
  preview: string;
  body: string;
};

const defaultPersonalization: PersonalizationSettings = {
  firstName: true,
  company: true,
  role: true,
  painPoint: true,
};

export function createDefaultCampaignBrief(brandName = "Your brand"): EmailCampaignBrief {
  return {
    campaignName: "A more personal first touch",
    brandName,
    senderName: "Your name",
    objective: "Book more consultations",
    audience: "Warm leads who engaged in the last 90 days",
    tone: "Warm & consultative",
    offer: "a complimentary 20-minute strategy session",
    context: "you are looking for a clearer path to your next growth milestone",
    callToAction: "Book your strategy session",
    sequenceLength: 3,
    personalization: { ...defaultPersonalization },
    recipient: {
      firstName: "Alex",
      company: "Northstar Co.",
      role: "Founder",
      painPoint: "turning good ideas into consistent pipeline",
    },
  };
}

function text(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function sentence(value: string): string {
  const result = text(value);
  if (!result) return "";
  return /[.!?]$/.test(result) ? result : `${result}.`;
}

function required(value: string, label: string, errors: string[]): void {
  if (!text(value)) errors.push(`${label} is required.`);
}

export function validateEmailCampaignBrief(brief: EmailCampaignBrief): string[] {
  const errors: string[] = [];
  required(brief.campaignName, "Campaign name", errors);
  required(brief.brandName, "Brand name", errors);
  required(brief.senderName, "Sender name", errors);
  required(brief.audience, "Audience", errors);
  required(brief.offer, "Offer or hook", errors);
  required(brief.callToAction, "Call to action", errors);
  if (!EMAIL_OBJECTIVES.includes(brief.objective)) errors.push("Choose a campaign objective.");
  if (!EMAIL_TONES.includes(brief.tone)) errors.push("Choose a campaign tone.");
  if (![1, 3, 5].includes(brief.sequenceLength)) errors.push("Choose a sequence length.");
  return errors;
}

type CampaignValues = {
  firstName: string;
  company: string;
  role: string;
  painPoint: string;
};

function campaignValues(brief: EmailCampaignBrief): CampaignValues {
  const recipient = brief.recipient;
  return {
    firstName: brief.personalization.firstName && text(recipient.firstName) ? text(recipient.firstName) : "there",
    company: brief.personalization.company && text(recipient.company) ? text(recipient.company) : "your team",
    role: brief.personalization.role && text(recipient.role) ? text(recipient.role) : "your team",
    painPoint: brief.personalization.painPoint && text(recipient.painPoint) ? text(recipient.painPoint) : "moving the next opportunity forward",
  };
}

function toneLead(tone: EmailTone, company: string): string {
  switch (tone) {
    case "Direct & confident": return `I’ll keep this focused: there may be a practical opportunity for ${company}`;
    case "Playful & energetic": return `A quick idea worth putting on your radar for ${company}`;
    case "Thoughtful & premium": return `I wanted to share a considered next step for ${company}`;
    default: return `I wanted to reach out personally about ${company}`;
  }
}

function objectiveLead(objective: EmailObjective): string {
  switch (objective) {
    case "Re-engage past customers": return "I’d love to reconnect and share what has changed since we last spoke";
    case "Launch a new offer": return "We’ve opened a new way for teams to get a focused win without adding more complexity";
    case "Share a useful resource": return "I put together something practical that should make the next step a little easier";
    default: return "I think a short conversation could surface a few useful opportunities";
  }
}

export function generateEmailCampaign(brief: EmailCampaignBrief): GeneratedCampaignEmail[] {
  if (validateEmailCampaignBrief(brief).length) return [];

  const values = campaignValues(brief);
  const brand = text(brief.brandName);
  const sender = text(brief.senderName);
  const offer = sentence(brief.offer);
  const context = sentence(brief.context) || "you are looking for a clearer path to your next growth milestone.";
  const callToAction = sentence(brief.callToAction);
  const audience = text(brief.audience);
  const companyLabel = values.company === "your team" ? "your team" : values.company;
  const roleLabel = values.role === "your team" ? "teams like yours" : values.role;
  const signoff = `Best,\n${sender}\n${brand}`;
  const lead = toneLead(brief.tone, companyLabel);
  const objective = objectiveLead(brief.objective);

  const emails: GeneratedCampaignEmail[] = [
    {
      id: "email-1",
      step: 1,
      delay: "Day 1",
      label: "The personal opener",
      subject: `A practical idea for ${companyLabel}`,
      preview: `${lead}.`,
      body: `Hi ${values.firstName},\n\n${lead}. ${objective}.\n\n${context}\n\nFor ${roleLabel}, that is where ${offer.toLowerCase()} can help.\n\n${callToAction}\n\n${signoff}`,
    },
    {
      id: "email-2",
      step: 2,
      delay: "Day 3",
      label: "The useful follow-up",
      subject: `A simple next step for ${companyLabel}`,
      preview: `A quick follow-up on ${offer.toLowerCase()}`,
      body: `Hi ${values.firstName},\n\nI wanted to follow up on my note about ${offer.toLowerCase()}\n\nIf ${values.painPoint}, this is designed to give you a clear first step without creating another big project. ${audience} can use it as a focused way to make progress.\n\nWould it be useful to talk through it? ${callToAction}\n\n${signoff}`,
    },
    {
      id: "email-3",
      step: 3,
      delay: "Day 6",
      label: "The value add",
      subject: `Something useful for ${companyLabel}`,
      preview: `One practical thought for ${values.painPoint}.`,
      body: `Hi ${values.firstName},\n\nOne last useful thought: the easiest way to make progress on ${values.painPoint} is to start with one small, measurable step.\n\nThat is exactly what ${offer.toLowerCase()} is meant to support. If the timing feels right, ${callToAction.toLowerCase()}\n\nEither way, I hope this gives ${companyLabel} a helpful angle to consider.\n\n${signoff}`,
    },
    {
      id: "email-4",
      step: 4,
      delay: "Day 10",
      label: "The gentle nudge",
      subject: `Is timing the only question?`,
      preview: "No pressure — I wanted to make the next step easy to evaluate.",
      body: `Hi ${values.firstName},\n\nI know priorities move quickly. If ${values.painPoint} is still on your list, I can send a short outline of what ${offer.toLowerCase()} would look like for ${companyLabel}.\n\nIf it is not a fit right now, just let me know and I’ll close the loop.\n\n${signoff}`,
    },
    {
      id: "email-5",
      step: 5,
      delay: "Day 14",
      label: "The respectful close",
      subject: `Should I close the loop?`,
      preview: "I’ll step back for now, unless this is still worth exploring.",
      body: `Hi ${values.firstName},\n\nI haven’t heard back, so I’ll close this out for now. If ${offer.toLowerCase()} becomes useful for ${companyLabel}, you can reply here and I’ll pick it up.\n\nWishing you and the team a strong quarter.\n\n${signoff}`,
    },
  ];

  return emails.slice(0, brief.sequenceLength);
}
