import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const MAX_BYTES = 1024 * 1024;
export interface SafeResponse { url: string; status: number; headers: Record<string, string>; body: string; redirects?: { url: string; status: number; location: string }[] }
export interface ResolvedAddress { address: string; family: number }
export interface FetchDependencies {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  transport?: (url: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<SafeResponse>;
  timeoutMs?: number;
  /** Runs before DNS/transport for every hop, including the initial URL. */
  validate?: (url: URL) => Promise<void> | void;
  redirect?: (from: URL, to: URL) => Promise<void> | void;
  signal?: AbortSignal;
}

/** Only globally routable unicast addresses; mapped IPv6 is checked as IPv4. */
export function isPublicIp(value: string): boolean {
  try {
    let address = ipaddr.parse(value);
    if (address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
    if (address.range() !== "unicast") return false;
    if (address.kind() === "ipv6") {
      const v6 = address as ipaddr.IPv6;
      return v6.match(ipaddr.IPv6.parse("2000::"), 3) &&
        !v6.match(ipaddr.IPv6.parse("2001::"), 23) &&
        !v6.match(ipaddr.IPv6.parse("2002::"), 16) &&
        !v6.match(ipaddr.IPv6.parse("3fff::"), 20);
    }
    return true;
  } catch { return false; }
}

export function validateFetchUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
    isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)\.?$/i.test(url.hostname) ||
    /(?:^|\.)home\.arpa\.?$/i.test(url.hostname)) throw new Error("Only public HTTP(S) websites on standard ports can be scanned.");
  return url;
}

function nativeTransport(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    // A fresh socket and a pinned lookup prevent a second, unvalidated DNS lookup.
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET", agent: false, signal,
      servername: url.hostname,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
      headers: { "User-Agent": "SEOCommandCenter/EDOrbit", Accept: "text/html,application/xhtml+xml,text/plain,application/xml,text/xml;q=0.9,*/*;q=0.1", "Accept-Encoding": "identity" },
    }, (response) => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
      const encoding = headers["content-encoding"]?.trim().toLowerCase();
      if ((encoding && encoding !== "identity") || Number(headers["content-length"]) > MAX_BYTES) {
        response.destroy(); reject(new Error("Unsupported encoding or oversized response.")); return;
      }
      // Redirect bodies are not needed and may be arbitrarily large.
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.destroy(); resolve({ url: url.href, status: response.statusCode!, headers, body: "" }); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(new Error("Response exceeds size limit.")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("Response was interrupted.")));
      response.on("end", () => resolve({ url: url.href, status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

/** Eight-second budget includes DNS, all redirect hops, and response bodies. */
export async function safeFetch(input: string, dependencies: FetchDependencies = {}): Promise<SafeResponse> {
  const controller = new AbortController();
  let rejectCancelled: (reason: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const abort = () => { controller.abort(); rejectCancelled(new Error("Website request cancelled.")); };
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  if (dependencies.signal?.aborted) abort();
  const timeoutMs = Math.min(dependencies.timeoutMs ?? 8000, 8000);
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Website request timed out.")); }, timeoutMs); });
  const work = async () => {
    let url = validateFetchUrl(input);
    const redirects: NonNullable<SafeResponse["redirects"]> = [];
    for (let hop = 0; hop <= 3; hop++) {
      if (controller.signal.aborted) throw new Error("Website request cancelled.");
      await dependencies.validate?.(url);
      if (controller.signal.aborted) throw new Error("Website request cancelled.");
      const addresses = await (dependencies.resolve ?? ((hostname) => lookup(hostname, { all: true, verbatim: true })))(url.hostname);
      if (controller.signal.aborted) throw new Error("Website request timed out.");
      if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address) || isIP(entry.address) !== entry.family)) throw new Error("Website resolves to a restricted network address.");
      const response = await (dependencies.transport ?? nativeTransport)(url, addresses[0], controller.signal);
      if (controller.signal.aborted) throw new Error("Website request timed out.");
      const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
      if (encoding && encoding !== "identity") throw new Error("Unsupported response encoding.");
      if (Buffer.byteLength(response.body) > MAX_BYTES) throw new Error("Response exceeds size limit.");
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 3 || !response.headers.location) throw new Error("Website redirect limit or invalid redirect.");
        const next = validateFetchUrl(new URL(response.headers.location, url).href);
        await dependencies.redirect?.(url, next);
        redirects.push({ url: url.href, status: response.status, location: next.href });
        url = next;
        continue;
      }
      return { ...response, url: url.href, ...(redirects.length ? { redirects } : {}) };
    }
    throw new Error("Website redirect limit exceeded.");
  };
  try { return await Promise.race([work(), deadline, cancelled]); }
  finally { clearTimeout(timer!); controller.abort(); dependencies.signal?.removeEventListener("abort", abort); }
}
