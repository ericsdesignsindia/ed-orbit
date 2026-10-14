import { normalizeDomain } from "./workspace";

/** Validate public host syntax but preserve www, protocol, and the entered page path. */
export function normalizeWebsiteUrl(input: string): string {
  if (typeof input !== "string" || input.length > 2048 || !input.trim() || /[\s\\]/.test(input.trim())) throw new Error("Enter a valid public website URL.");
  const value = input.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
  normalizeDomain(url.href);
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  url.hash = "";
  return url.href;
}
