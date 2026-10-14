export const PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "YouTube", "TikTok", "X", "Pinterest"] as const;
export type Platform = typeof PLATFORMS[number];
export const POST_STATUSES = ["Draft", "Needs review", "Scheduled", "Publishing", "Published"] as const;
export type PostStatus = typeof POST_STATUSES[number];
export const POST_TYPES = ["Carousel", "Reel", "Static", "Video"] as const;
export type PostType = typeof POST_TYPES[number];
export const SOCIAL_TIMEZONE = "Asia/Kolkata";
export type Channel = { platform: Platform; handle: string; url: string };
export type Client = {
  id: string; name: string; handle: string; initials: string; color: string; accent: string;
  email: string; channels: Channel[]; archived: boolean; example: boolean;
};
export type Post = {
  id: string; clientId: string; title: string; copy: string; platform: Platform; status: PostStatus;
  date: string; time: string; type: PostType; assetUrl: string; publishedUrl: string; example: boolean;
};
export type ClientNote = { id: string; clientId: string; text: string; resolved: boolean; createdAt: string; example: boolean };
export type SocialMetric = { id: string; clientId: string; platform: Platform; date: string; reach: number; engagements: number; followers: number; example: boolean };
export type SocialSnapshot = {
  version: 1; revision: number; updatedAt: string; agencyName: string;
  clients: Client[]; posts: Post[]; notes: ClientNote[]; metrics: SocialMetric[];
};
export type ClientInput = Pick<Client, "name" | "handle" | "email" | "channels"> & { id?: string };
export type PostInput = Omit<Post, "id" | "example"> & { id?: string };
export type SocialAction =
  | { action: "save-client"; client: ClientInput }
  | { action: "archive-client"; id: string; archived: boolean }
  | { action: "save-post"; post: PostInput }
  | { action: "set-status"; id: string; status: PostStatus; publishedUrl?: string }
  | { action: "delete-post"; id: string }
  | { action: "add-note"; clientId: string; text: string }
  | { action: "resolve-note"; id: string; resolved: boolean }
  | { action: "save-metric"; metric: Omit<SocialMetric, "id" | "example"> }
  | { action: "save-metrics"; metrics: Omit<SocialMetric, "id" | "example">[] }
  | { action: "settings"; agencyName: string }
  | { action: "remove-examples" }
  | { action: "restore"; backup: unknown };
export type SocialRequest = SocialAction | { action: "hydrate-and-dispatch"; base: SocialSnapshot; next: SocialAction };

export function todayInZone(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SOCIAL_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export function startOfWeek(date: string): string {
  return addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function displayDate(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
export function displayTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "2000-01-01" && value <= "2100-12-31" && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function isFuturePlan(date: string, time: string, now = new Date()): boolean {
  return Date.parse(`${date}T${time}:00+05:30`) > now.getTime();
}
export function filterPosts(posts: Post[], clients: Client[], clientId: string, status: "All" | PostStatus, search: string, platform: "All" | Platform = "All"): Post[] {
  const active = new Set(clients.filter(c => !c.archived).map(c => c.id));
  return posts.filter(post => active.has(post.clientId) && (clientId === "all" || post.clientId === clientId) && (status === "All" || post.status === status) && (platform === "All" || post.platform === platform) && `${post.title} ${post.copy} ${clients.find(c => c.id === post.clientId)?.name ?? ""}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
export function reportSummary(metrics: SocialMetric[], clientId: string, from: string, to: string, platform: "All" | Platform = "All") {
  const selected = metrics.filter(m => (clientId === "all" || m.clientId === clientId) && m.date >= from && m.date <= to && (platform === "All" || m.platform === platform));
  const reach = selected.reduce((sum, m) => sum + m.reach, 0);
  const engagements = selected.reduce((sum, m) => sum + m.engagements, 0);
  const daily = Array.from({ length: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 }, (_, i) => {
    const date = addDays(from, i);
    return { date, reach: selected.filter(m => m.date === date).reduce((sum, m) => sum + m.reach, 0), engagements: selected.filter(m => m.date === date).reduce((sum, m) => sum + m.engagements, 0) };
  });
  return { reach, engagements, rate: reach ? engagements / reach * 100 : null, count: selected.length, daily, example: selected.some(m => m.example) };
}
export function csvText(rows: (string | number)[][]): string {
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = typeof value === "string" && /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n");
}
export function createEmptyWorkspace(now = new Date()): SocialSnapshot {
  return { version: 1, revision: 0, updatedAt: now.toISOString(), agencyName: "Your agency", clients: [], posts: [], notes: [], metrics: [] };
}
