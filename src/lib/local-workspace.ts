import { WorkspaceError } from "./api-security";

export const BUSINESS_TYPES = ["LocalBusiness", "HVACBusiness", "Dentist", "HealthClub", "Plumber", "Electrician", "ProfessionalService"] as const;
export type LocalBusiness = { name: string; category: typeof BUSINESS_TYPES[number]; ownerName: string; phone: string; whatsapp: string; website: string; gbpUrl: string; gbpConnected: boolean; lastSyncedAt: string | null; description: string; currency: string };
export type LocalService = { id: string; name: string; description: string };
export type LocalLocation = { id: string; city: string; region: string; address: string; postalCode: string; country: string; details: string; googleName: string };
export type LocalPageStatus = "Draft" | "Live" | "Needs review";
export type LocalPage = { id: string; serviceId: string; locationId: string; service: string; location: string; keyword: string; slug: string; title: string; intro: string; body: string; status: LocalPageStatus; visits: number; calls: number; whatsappClicks: number; formSubmissions: number; createdAt: string; updatedAt: string };
export type LocalLeadChannel = "WhatsApp" | "Call" | "Form";
export type LocalLead = { id: string; pageId: string; name: string; phone: string; email: string; channel: LocalLeadChannel; status: "New" | "Contacted" | "Booked"; notes: string; value: number | null; createdAt: string };
export type LocalContentBlock = { id: string; title: string; type: "Testimonial" | "FAQ" | "Location intro"; body: string; author: string; locationId: string };
export type LocalWorkspace = {
  version: 1; revision: number; updatedAt: string;
  business: LocalBusiness; services: LocalService[]; locations: LocalLocation[]; pages: LocalPage[]; leads: LocalLead[]; contentBlocks: LocalContentBlock[];
  daily: { date: string; views: number; calls: number; whatsapp: number; forms: number }[];
  receipts: string[];
  google: { selected: string[]; autoSync: boolean; lastSyncedAt: string | null; lastError: string };
};
export type LocalAction =
  | { action: "business"; business: LocalBusiness }
  | { action: "service"; service: Omit<LocalService, "id"> & { id?: string } }
  | { action: "location"; location: Omit<LocalLocation, "id" | "googleName"> & { id?: string } }
  | { action: "block"; block: Omit<LocalContentBlock, "id"> & { id?: string } }
  | { action: "remove"; kind: "service" | "location" | "block" | "page" | "lead"; id: string }
  | { action: "generate"; serviceIds: string[]; locationIds: string[] }
  | { action: "page"; id: string; title: string; intro: string; body: string; status: LocalPageStatus }
  | { action: "lead"; lead: Omit<LocalLead, "id" | "createdAt"> & { id?: string } }
  | { action: "restore"; backup: LocalWorkspace }
  | { action: "profile-check"; connect: boolean }
  | { action: "google-settings"; selected: string[]; autoSync: boolean };

export function emptyLocalWorkspace(now = new Date()): LocalWorkspace {
  return { version: 1, revision: 0, updatedAt: now.toISOString(), business: { name: "", category: "LocalBusiness", ownerName: "", phone: "", whatsapp: "", website: "", gbpUrl: "", gbpConnected: false, lastSyncedAt: null, description: "", currency: "USD" }, services: [], locations: [], pages: [], leads: [], contentBlocks: [], daily: [], receipts: [], google: { selected: [], autoSync: false, lastSyncedAt: null, lastError: "" } };
}
export const fail = (message: string, status = 400): never => { throw new WorkspaceError(message, status); };
export function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid record."); return value as Record<string, unknown>; }
export function text(value: unknown, max = 5000, required = false): string { if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`Enter ${required ? "a non-empty" : "a valid"} text value (up to ${max} characters).`); return (value as string).trim(); }
function option<T extends string>(value: unknown, choices: readonly T[]): T { if (!choices.includes(value as T)) fail("Choose a valid option."); return value as T; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1e12) fail("Invalid count."); return Number(value); }
function date(value: unknown): string { const s = text(value, 50, true); if (!Number.isFinite(Date.parse(s))) fail("Invalid date."); return s; }
function array(value: unknown, limit: number): unknown[] { if (!Array.isArray(value) || value.length > limit) fail("Record limit exceeded."); return value as unknown[]; }
export function identifier(value: unknown): string { const id = text(value, 120, true); if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail("Invalid identifier."); return id; }
export function randomLocalId(prefix: string): string { return `${prefix}-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`; }
export function phoneNumber(value: unknown, required = false): string { const result = text(value, 35, required); if (result && !/^\+?[\d ()-]{7,35}$/.test(result)) fail("Enter a phone number including the country code."); return result; }
export function webUrl(value: unknown): string { const s = text(value, 2048); if (!s) return ""; try { const u = new URL(s); if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error(); return u.href; } catch { return fail("Enter a full HTTP(S) URL without credentials."); } }
export function businessFields(value: unknown): LocalBusiness { const b = record(value), currency = text(b.currency, 3, true).toUpperCase(); try { new Intl.NumberFormat("en-US", { style: "currency", currency }); } catch { fail("Choose a three-letter currency code."); } return { name: text(b.name, 100), category: option(b.category, BUSINESS_TYPES), ownerName: text(b.ownerName, 100), phone: phoneNumber(b.phone), whatsapp: phoneNumber(b.whatsapp), website: webUrl(b.website), gbpUrl: webUrl(b.gbpUrl), gbpConnected: b.gbpConnected === true, lastSyncedAt: b.lastSyncedAt === null || b.lastSyncedAt === undefined ? null : date(b.lastSyncedAt), description: text(b.description), currency }; }
export function serviceFields(value: unknown): Omit<LocalService, "id"> { const s = record(value); return { name: text(s.name, 100, true), description: text(s.description, 5000, true) }; }
export function locationFields(value: unknown): Omit<LocalLocation, "id" | "googleName"> { const l = record(value); return { city: text(l.city, 100, true), region: text(l.region, 100), address: text(l.address, 250), postalCode: text(l.postalCode, 30), country: text(l.country, 2), details: text(l.details) }; }
export function blockFields(value: unknown): Omit<LocalContentBlock, "id"> { const b = record(value), type = option(b.type, ["Testimonial", "FAQ", "Location intro"] as const); return { title: text(b.title, 250, true), type, body: text(b.body, 5000, true), author: text(b.author, 100, type === "Testimonial"), locationId: text(b.locationId, 120) }; }
export function leadFields(value: unknown): Omit<LocalLead, "id" | "createdAt"> {
  const l = record(value), email = text(l.email, 254), phone = phoneNumber(l.phone);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.");
  if (!phone && !email) fail("Enter a phone number or email so you can reply to the enquiry.");
  if (l.value !== null && (typeof l.value !== "number" || !Number.isFinite(l.value) || l.value < 0 || l.value > 1e9)) fail("Enter a valid non-negative lead value.");
  return { pageId: text(l.pageId, 120), name: text(l.name, 100, true), phone, email, channel: option(l.channel, ["Call", "WhatsApp", "Form"] as const), status: option(l.status, ["New", "Contacted", "Booked"] as const), notes: text(l.notes), value: l.value as number | null };
}
export function validateLocalWorkspace(value: unknown): LocalWorkspace {
  const s = record(value); if (s.version !== 1) fail("Unsupported LocalPilot backup.");
  const services = array(s.services, 100).map(v => { const r = record(v); return { ...serviceFields(r), id: identifier(r.id) }; });
  const locations = array(s.locations, 100).map(v => { const r = record(v); return { ...locationFields(r), id: identifier(r.id), googleName: text(r.googleName, 150) }; });
  const pages = array(s.pages, 2000).map(v => { const p = record(v), slug = text(p.slug, 180, true); if (!/^[a-z0-9-]+$/.test(slug)) fail("Invalid page URL."); return { id: identifier(p.id), serviceId: identifier(p.serviceId), locationId: identifier(p.locationId), service: text(p.service, 150, true), location: text(p.location, 150, true), keyword: text(p.keyword, 250, true), slug, title: text(p.title, 250, true), intro: text(p.intro, 5000, true), body: text(p.body, 10000, true), status: option(p.status, ["Draft", "Live", "Needs review"] as const), visits: count(p.visits), calls: count(p.calls), whatsappClicks: count(p.whatsappClicks), formSubmissions: count(p.formSubmissions), createdAt: date(p.createdAt), updatedAt: date(p.updatedAt) }; });
  const leads = array(s.leads, 5000).map(v => { const r = record(v); return { ...leadFields(r), id: identifier(r.id), createdAt: date(r.createdAt) }; });
  const contentBlocks = array(s.contentBlocks, 500).map(v => { const r = record(v); return { ...blockFields(r), id: identifier(r.id) }; });
  for (const list of [services, locations, pages, leads, contentBlocks]) if (new Set(list.map(r => r.id)).size !== list.length) fail("Duplicate record identifiers.");
  if (new Set(pages.map(p => p.slug)).size !== pages.length || new Set(pages.map(p => `${p.serviceId}:${p.locationId}`)).size !== pages.length) fail("Duplicate page combinations or URLs.");
  const serviceIds = new Set(services.map(r => r.id)), locationIds = new Set(locations.map(r => r.id)), pageIds = new Set(pages.map(r => r.id));
  if (pages.some(p => !serviceIds.has(p.serviceId) || !locationIds.has(p.locationId)) || contentBlocks.some(b => b.locationId && !locationIds.has(b.locationId)) || leads.some(l => l.pageId && !pageIds.has(l.pageId))) fail("A record references a missing service, location, or page.");
  const daily = array(s.daily, 180).map(v => { const r = record(v), day = text(r.date, 10, true); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail("Invalid metric date."); return { date: day, views: count(r.views), calls: count(r.calls), whatsapp: count(r.whatsapp), forms: count(r.forms) }; });
  const g = record(s.google); if (g.autoSync !== true && g.autoSync !== false) fail("Invalid sync setting.");
  return { version: 1, revision: count(s.revision), updatedAt: date(s.updatedAt), business: businessFields(s.business), services, locations, pages, leads, contentBlocks, daily, receipts: array(s.receipts, 5000).map(identifier), google: { selected: array(g.selected, 100).map(v => googleLocationName(v)), autoSync: g.autoSync as boolean, lastSyncedAt: g.lastSyncedAt === null ? null : date(g.lastSyncedAt), lastError: text(g.lastError, 500) } };
}
export function googleLocationName(value: unknown): string { const s = text(value, 150, true); if (!/^locations\/\d{1,30}$/.test(s)) fail("Choose a Google Business Profile location."); return s; }
export function locationLabel(location: Pick<LocalLocation, "city" | "region">): string { return [location.city, location.region].filter(Boolean).join(", "); }
export function slugify(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "service-area"; }
export function buildPageCopy(business: LocalBusiness, service: LocalService, location: LocalLocation) {
  const place = locationLabel(location);
  return { service: service.name, location: place, keyword: `${service.name} ${place}`.trim(), title: `${service.name} in ${place} | ${business.name}`, intro: `${business.name} provides ${service.name.toLowerCase()} in ${place}. ${service.description}`, body: [business.description, location.details || `Contact ${business.name} to discuss ${service.name.toLowerCase()} in ${place} and confirm availability for your address.`].filter(Boolean).join("\n\n") };
}
export function pageBlocks(s: LocalWorkspace, p: LocalPage) { return s.contentBlocks.filter(b => !b.locationId || b.locationId === p.locationId); }
export function buildPageSchema(s: LocalWorkspace, p: LocalPage, origin: string): Record<string, unknown> {
  const location = s.locations.find(l => l.id === p.locationId)!, service = s.services.find(l => l.id === p.serviceId)!, url = `${origin}/directory/${p.slug}`, businessId = `${origin}/directory#business`;
  const business: Record<string, unknown> = { "@type": s.business.category, "@id": businessId, name: s.business.name, description: s.business.description || undefined, telephone: s.business.phone || undefined, url: s.business.website || `${origin}/directory`, areaServed: s.locations.map(l => ({ "@type": "Place", name: locationLabel(l) })) };
  if (location.address) business.address = { "@type": "PostalAddress", streetAddress: location.address, addressLocality: location.city, addressRegion: location.region || undefined, postalCode: location.postalCode || undefined, addressCountry: location.country || undefined };
  const graph: Record<string, unknown>[] = [business, { "@type": "Service", "@id": `${url}#service`, name: service.name, description: p.intro, serviceType: service.name, provider: { "@id": businessId }, areaServed: { "@type": "Place", name: locationLabel(location) }, url }, { "@type": "WebPage", "@id": url, name: p.title, description: p.intro, about: { "@id": `${url}#service` } }];
  const faqs = pageBlocks(s, p).filter(b => b.type === "FAQ");
  if (faqs.length) graph.push({ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: faqs.map(b => ({ "@type": "Question", name: b.title, acceptedAnswer: { "@type": "Answer", text: b.body } })) });
  return { "@context": "https://schema.org", "@graph": graph };
}
export function safeSchemaJson(value: unknown): string { return JSON.stringify(value).replace(/</g, "\\u003c"); }
export function csvText(rows: (string | number)[][]): string { return rows.map(row => row.map(cell => { const s = String(cell); return `"${(/^[=+@-]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"`; }).join(",")).join("\r\n"); }
export function dateInZone(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }

/** Pure mutations shared by SQLite and hosted storage. Public inputs use a separate entry point. */
export function changeLocalWorkspace(before: LocalWorkspace, input: unknown, now = new Date(), newId = () => crypto.randomUUID()): LocalWorkspace {
  const s = structuredClone(before), a = record(input), timestamp = now.toISOString();
  const find = <T extends { id: string }>(list: T[], id: unknown): T => list.find(r => r.id === identifier(id)) ?? fail("Record not found.", 404);
  const review = (test: (p: LocalPage) => boolean) => s.pages.forEach(p => { if (test(p)) { p.status = "Needs review"; p.updatedAt = timestamp; } });
  switch (a.action) {
    case "business": s.business = businessFields(a.business); if (!s.business.name) fail("Enter your business name."); break;
    case "service": {
      const r = record(a.service), fields = serviceFields(r), old = r.id ? find(s.services, r.id) : undefined;
      if (s.services.some(r => r.id !== old?.id && r.name.toLowerCase() === fields.name.toLowerCase())) fail("That service already exists.");
      if (old) { Object.assign(old, fields); review(p => p.serviceId === old.id); } else { if (s.services.length >= 100) fail("Service limit reached."); s.services.push({ id: newId(), ...fields }); } break;
    }
    case "location": {
      const r = record(a.location), fields = locationFields(r), old = r.id ? find(s.locations, r.id) : undefined;
      if (s.locations.some(l => l.id !== old?.id && locationLabel(l).toLowerCase() === locationLabel(fields).toLowerCase())) fail("That location already exists.");
      if (old) { Object.assign(old, fields); review(p => p.locationId === old.id); } else { if (s.locations.length >= 100) fail("Location limit reached."); s.locations.push({ id: newId(), ...fields, googleName: "" }); } break;
    }
    case "block": { const r = record(a.block), fields = blockFields(r); if (fields.locationId) find(s.locations, fields.locationId); if (r.id) Object.assign(find(s.contentBlocks, r.id), fields); else { if (s.contentBlocks.length >= 500) fail("Content block limit reached."); s.contentBlocks.push({ id: newId(), ...fields }); } break; }
    case "generate": {
      if (!s.business.name) fail("Save your business profile first.");
      const services = [...new Set(array(a.serviceIds, 100).map(id => find(s.services, id)))], locations = [...new Set(array(a.locationIds, 100).map(id => find(s.locations, id)))];
      if (!services.length || !locations.length) fail("Select at least one service and one location.");
      if (services.length * locations.length > 200) fail("Generate up to 200 combinations at a time.");
      let added = 0;
      for (const service of services) for (const location of locations) {
        if (s.pages.some(p => p.serviceId === service.id && p.locationId === location.id)) continue;
        if (s.pages.length >= 2000) fail("Page limit reached.");
        const base = slugify(`${service.name}-${locationLabel(location)}`); let slug = base, n = 2; while (s.pages.some(p => p.slug === slug)) slug = `${base}-${n++}`;
        s.pages.unshift({ id: newId(), serviceId: service.id, locationId: location.id, slug, ...buildPageCopy(s.business, service, location), status: "Draft", visits: 0, calls: 0, whatsappClicks: 0, formSubmissions: 0, createdAt: timestamp, updatedAt: timestamp }); added++;
      }
      if (!added) fail("Those service/location pages already exist."); break;
    }
    case "page": { const p = find(s.pages, a.id); Object.assign(p, { title: text(a.title, 250, true), intro: text(a.intro, 5000, true), body: text(a.body, 10000, true), status: option(a.status, ["Draft", "Live", "Needs review"] as const), updatedAt: timestamp }); if (p.status === "Live" && !s.business.name) fail("Save a business name before publishing."); break; }
    case "lead": { const l = record(a.lead), fields = leadFields(l); if (fields.pageId) find(s.pages, fields.pageId); if (l.id) Object.assign(find(s.leads, l.id), fields); else { if (s.leads.length >= 5000) fail("Lead limit reached; export and remove older records."); s.leads.unshift({ id: newId(), ...fields, createdAt: timestamp }); } break; }
    case "remove": {
      const id = identifier(a.id);
      switch (a.kind) {
        case "service": find(s.services, id); if (s.pages.some(p => p.serviceId === id)) fail("Remove its landing pages before removing this service."); s.services = s.services.filter(r => r.id !== id); break;
        case "location": find(s.locations, id); if (s.pages.some(p => p.locationId === id) || s.contentBlocks.some(b => b.locationId === id)) fail("Remove its pages and location-specific blocks first."); s.locations = s.locations.filter(r => r.id !== id); break;
        case "page": find(s.pages, id); s.leads.forEach(l => { if (l.pageId === id) l.pageId = ""; }); s.pages = s.pages.filter(r => r.id !== id); break;
        case "lead": find(s.leads, id); s.leads = s.leads.filter(r => r.id !== id); break;
        case "block": find(s.contentBlocks, id); s.contentBlocks = s.contentBlocks.filter(r => r.id !== id); break;
        default: fail("Invalid record kind.");
      } break;
    }
    case "restore": { const backup = validateLocalWorkspace(a.backup); Object.assign(s, backup, { revision: before.revision, google: { ...backup.google, selected: [], autoSync: false, lastSyncedAt: null, lastError: "" } }); break; }
    case "profile-check": { if (a.connect !== true && a.connect !== false) fail("Invalid profile connection setting."); s.business.gbpConnected = a.connect === true; s.business.lastSyncedAt = timestamp; s.google.lastSyncedAt = timestamp; s.google.lastError = ""; break; }
    case "google-settings": if (a.autoSync !== true && a.autoSync !== false) fail("Invalid sync option."); s.google.selected = [...new Set(array(a.selected, 100).map(googleLocationName))]; s.google.autoSync = a.autoSync === true; break;
    default: fail("Unknown LocalPilot action.");
  }
  s.revision = before.revision + 1; s.updatedAt = timestamp;
  return validateLocalWorkspace(s);
}

export function recordPublicActivity(before: LocalWorkspace, input: unknown, now = new Date(), newId = () => crypto.randomUUID()): LocalWorkspace {
  const a = record(input), s = structuredClone(before), id = identifier(a.eventId), page = s.pages.find(p => p.id === identifier(a.pageId) && p.status === "Live");
  const p = page ?? fail("This landing page is unavailable.", 404);
  if (s.receipts.includes(id)) return s;
  const kind = option(a.kind, ["view", "call", "whatsapp", "form"] as const);
  if (kind === "call" && !s.business.phone || kind === "whatsapp" && !s.business.whatsapp) fail("This contact method is not configured.");
  if (kind === "form") {
    if (text(a.website ?? "", 2048)) fail("Could not submit the enquiry."); // hidden honeypot
    if (s.leads.length >= 5000) fail("The enquiry inbox is full. Please contact the business directly.", 503);
    const fields = leadFields({ ...record(a.lead), pageId: p.id, channel: "Form", status: "New", value: null });
    s.leads.unshift({ id: newId(), ...fields, createdAt: now.toISOString() }); p.formSubmissions++;
  } else if (kind === "view") p.visits++; else if (kind === "call") p.calls++; else p.whatsappClicks++;
  const day = dateInZone(now); let metric = s.daily.find(m => m.date === day);
  if (!metric) { metric = { date: day, views: 0, calls: 0, whatsapp: 0, forms: 0 }; s.daily.push(metric); }
  metric[kind === "view" ? "views" : kind === "call" ? "calls" : kind === "whatsapp" ? "whatsapp" : "forms"]++;
  s.daily = s.daily.sort((a, b) => a.date.localeCompare(b.date)).slice(-180); s.receipts = [...s.receipts, id].slice(-5000); s.revision++; s.updatedAt = now.toISOString();
  return validateLocalWorkspace(s);
}
