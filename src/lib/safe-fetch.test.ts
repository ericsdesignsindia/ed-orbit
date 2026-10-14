import test from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, safeFetch, validateFetchUrl, type SafeResponse } from "./safe-fetch";

test("public address validation rejects private, reserved, and mapped private addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::", "garbage"]) assert.equal(isPublicIp(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicIp(address), true, address);
});
test("URL validation rejects literal IPs, credentials, custom ports and schemes", () => {
  for (const url of ["http://127.1", "http://2130706433", "http://[::1]", "https://user:pass@example.com", "https://example.com:8080", "file:///etc/passwd", "http://localhost"]) assert.throws(() => validateFetchUrl(url), url);
});
const response = (url: string, status = 200, headers = {}): SafeResponse => ({ url, status, headers, body: "hello" });
test("mixed DNS answers fail closed before transport", async () => {
  let called = false;
  await assert.rejects(safeFetch("https://example.com", {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }],
    transport: async (url) => { called = true; return response(url.href); },
  }), /restricted/);
  assert.equal(called, false);
});
test("every redirect resolves afresh and passes validated address to transport", async () => {
  let resolutions = 0; let requests = 0;
  await assert.rejects(safeFetch("https://example.com", {
    resolve: async () => [{ address: ++resolutions === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }],
    transport: async (url, address) => { requests++; assert.equal(address.address, "8.8.8.8"); return response(url.href, 302, { location: "/next" }); },
  }), /restricted/);
  assert.equal(resolutions, 2); assert.equal(requests, 1);
});
test("redirect limit and body limit are enforced", async () => {
  const resolve = async () => [{ address: "8.8.8.8", family: 4 }]; let requests = 0;
  await assert.rejects(safeFetch("https://example.com", { resolve, transport: async (url) => { requests++; return response(url.href, 302, { location: "/next" }); } }), /redirect/);
  assert.equal(requests, 4);
  await assert.rejects(safeFetch("https://example.com", { resolve, transport: async (url) => ({ ...response(url.href), body: "x".repeat(1024 * 1024 + 1) }) }), /size/);
});
test("DNS resolution is included in timeout budget", async () => {
  await assert.rejects(safeFetch("https://example.com", { timeoutMs: 10, resolve: () => new Promise(() => {}) }), /timed out/);
});
test("redirect guard runs before destination DNS and reports successful hops", async () => {
  const urls: string[] = []; const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
  const transport = async (url: URL) => { urls.push(url.href); return url.pathname === "/" ? response(url.href, 301, { location: "/next" }) : response(url.href); };
  await assert.rejects(safeFetch("https://example.com", { resolve, transport, redirect: () => { throw new Error("policy denied"); } }), /policy denied/);
  assert.deepEqual(urls, ["https://example.com/"]);
  const result = await safeFetch("https://example.com", { resolve, transport }); assert.equal(result.redirects?.length, 1); assert.equal(result.url, "https://example.com/next");
});
test("unsupported encodings and redirects to IP literals are refused", async () => {
  const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
  await assert.rejects(safeFetch("https://example.com", { resolve, transport: async (url) => response(url.href, 200, { "content-encoding": "gzip" }) }), /encoding/);
  await assert.rejects(safeFetch("https://example.com", { resolve, transport: async (url) => response(url.href, 302, { location: "http://169.254.169.254/latest/meta-data" }) }), /public/);
});
