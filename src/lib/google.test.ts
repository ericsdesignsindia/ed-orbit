import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocalRequest, clearGoogleVault, decryptCookie, encryptCookie, fetchGoogleJson, GoogleError, googleProperties, googleReport, mergeSearchInsights, parseTokens, percentChange, readGoogleConfig, readGoogleVault, refreshGoogleTokens, refreshStoredGoogleSession, reportDates, tokenServices, validatePropertyId, validateSiteUrl, writeGoogleVault } from "./google";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const key = "ab".repeat(32);
test("encrypted cookies round-trip and reject tampering, wrong keys, malformed data", () => {
  const value = { accessToken: "secret", expiresAt: 12345 };
  const encrypted = encryptCookie(value, key);
  assert.deepEqual(decryptCookie(encrypted, key), value);
  assert.ok(!encrypted.includes("secret"));
  const tampered = Buffer.from(encrypted, "base64url"); tampered[30] ^= 1;
  assert.equal(decryptCookie(tampered.toString("base64url"), key), undefined);
  assert.equal(decryptCookie(encrypted, "cd".repeat(32)), undefined);
  assert.equal(decryptCookie("not-valid-data", key), undefined);
  assert.notEqual(encryptCookie(value, key), encrypted);
});

test("configuration validates key and loopback callback origins", () => {
  assert.deepEqual(readGoogleConfig({}).missing, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"]);
  const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TOKEN_ENCRYPTION_KEY: key };
  assert.equal(readGoogleConfig(env).config?.baseUrl, "http://localhost:3000");
  assert.equal(readGoogleConfig({ ...env, APP_BASE_URL: "http://127.0.0.1:3000" }).missing.length, 0);
  for (const base of ["https://example.com", "http://localhost.evil.test", "http://user:password@localhost", "http://localhost/callback", "http://localhost?evil=true", "ftp://localhost"]) assert.deepEqual(readGoogleConfig({ ...env, APP_BASE_URL: base }).missing, ["APP_BASE_URL"]);
  assert.deepEqual(readGoogleConfig({ ...env, TOKEN_ENCRYPTION_KEY: "secret" }).missing, ["TOKEN_ENCRYPTION_KEY"]);
});

test("security guard rejects host rebinding, cross-origin reads and non-same-origin mutations", () => {
  const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers: { host: new URL(url).host, ...headers } });
  assert.doesNotThrow(() => assertLocalRequest(request("http://localhost:3000/api/google/status")));
  assert.doesNotThrow(() => assertLocalRequest(request("http://127.0.0.1:3000/api/google/report", { origin: "http://127.0.0.1:3000" }), true));
  assert.doesNotThrow(() => assertLocalRequest(request("http://127.0.0.1:3000/api/google/report", { host: "localhost:3000", origin: "http://localhost:3000" }), true));
  assert.doesNotThrow(() => assertLocalRequest(request("http://localhost:3000/api/google/callback", { "sec-fetch-site": "cross-site" })));
  assert.throws(() => assertLocalRequest(request("http://evil.test/api/google/status")));
  assert.throws(() => assertLocalRequest(request("http://localhost:3000/api/google/status", { host: "evil.test" })));
  assert.throws(() => assertLocalRequest(request("http://localhost:3000/api/google/status", { origin: "https://evil.test" })));
  assert.throws(() => assertLocalRequest(request("http://localhost:3000/api/google/status", { origin: "null" })));
  assert.throws(() => assertLocalRequest(request("http://localhost:3000/api/google/status", { "sec-fetch-site": "cross-site" })));
  assert.throws(() => assertLocalRequest(request("http://localhost:3000/api/google/report"), true));
});

test("property validation prevents path injection and dates include exactly requested days", () => {
  assert.equal(validatePropertyId("properties/123"), "123");
  assert.equal(validatePropertyId("123"), "123");
  for (const value of [123, "../123", "properties/1:runReport", "123?key=x", ""]) assert.throws(() => validatePropertyId(value));
  assert.equal(validateSiteUrl("sc-domain:example.com"), "sc-domain:example.com");
  assert.equal(validateSiteUrl("https://example.com/blog/"), "https://example.com/blog/");
  for (const value of ["javascript:alert(1)", "https://user:pass@example.com", "sc-domain:../foo", "https://example.com/#fragment"]) assert.throws(() => validateSiteUrl(value));
  assert.deepEqual(reportDates(7, new Date("2026-03-03T01:00:00Z")), { startDate: "2026-02-22", endDate: "2026-02-28" });
  assert.deepEqual(reportDates(30, new Date("2026-01-03T23:00:00Z")), { startDate: "2025-12-02", endDate: "2025-12-31" });
  assert.throws(() => reportDates("7"));
  assert.throws(() => reportDates(365));
});

test("report transport uses encoded properties, readonly metrics, and weighted GSC position", async (t) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    calls.push({ url: input, body: JSON.parse(init.body as string) });
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer private-token");
    return Response.json(input.includes("searchAnalytics") ? { rows: [{ keys: ["2026-02-27"], clicks: 2, impressions: 10, position: 2 }, { keys: ["2026-02-28"], clicks: 4, impressions: 30, position: 6 }] } : { rows: [{ metricValues: [{ value: "42" }, { value: "50" }, { value: "100" }, { value: "3" }] }] });
  });
  const report = await googleReport("private-token", { siteUrl: "https://example.com/", propertyId: "properties/123", days: 7 }, new Date("2026-03-03T12:00:00Z"));
  assert.equal(report.gsc?.clicks, 6);
  assert.equal(report.gsc?.impressions, 40);
  assert.equal(report.gsc?.ctr, 0.15);
  assert.equal(report.gsc?.position, 5);
  assert.deepEqual(report.ga4, { users: 42, sessions: 50, pageViews: 100, keyEvents: 3, trafficScope: "organic-search" });
  assert.ok(calls[0].url.includes("https%3A%2F%2Fexample.com%2F"));
  const analytics = calls.find(call => call.url.includes("analyticsdata"))!;
  assert.equal(analytics.url, "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport");
  assert.deepEqual(analytics.body.dimensionFilter, { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search", caseSensitive: true } } });
  assert.equal(calls.length, 7);
  assert.ok(calls.filter(call => call.url.includes("searchAnalytics")).every(call => call.body.rowLimit === 1000));
  assert.deepEqual(report.comparison?.changes, { clicksPercent: 0, impressionsPercent: 0 });
  assert.equal(report.errors, undefined);
  assert.ok(!JSON.stringify(report).includes("private-token"));
});

test("partial API failures preserve successful source without exposing upstream secrets", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => input.includes("searchAnalytics") ? new Response("secret upstream diagnostic", { status: 403 }) : Response.json({ rows: [] }));
  const report = await googleReport("private-token", { siteUrl: "sc-domain:example.com", propertyId: "123", days: 30 });
  assert.equal(report.gsc, undefined);
  assert.deepEqual(report.ga4, { users: 0, sessions: 0, pageViews: 0, keyEvents: 0, trafficScope: "organic-search" });
  assert.equal(report.errors?.length, 1);
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("optional grants are retained; a new OAuth exchange never inherits another account's refresh token", () => {
  const data = { access_token: "access", token_type: "Bearer", expires_in: 3600, scope: "https://www.googleapis.com/auth/webmasters.readonly", refresh_token: "refresh" };
  const gsc = parseTokens(data);
  assert.deepEqual(tokenServices(gsc), { gsc: true, ga4: false });
  const ga4 = parseTokens({ ...data, scope: "https://www.googleapis.com/auth/analytics.readonly", refresh_token: undefined });
  assert.deepEqual(tokenServices(ga4), { gsc: false, ga4: true });
  assert.equal(ga4.refreshToken, undefined);
  assert.notEqual(gsc.sessionId, ga4.sessionId);
  assert.equal(parseTokens({ ...data, refresh_token: undefined, scope: undefined }, gsc).refreshToken, "refresh");
  assert.throws(() => parseTokens({ ...data, scope: "unrelated" }));
});

test("refresh distinguishes revoked authorization from transient failures and allows a later retry", async (t) => {
  const original = parseTokens({ access_token: "old-access", refresh_token: "private-refresh", expires_in: 1, token_type: "Bearer" });
  const config = { clientId: "id", clientSecret: "private-secret", key, baseUrl: "http://localhost:3000" };
  let status = 503, calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return status === 200 ? Response.json({ access_token: "new-access", expires_in: 3600, token_type: "Bearer" }) : Response.json({ error: status === 400 ? "invalid_grant" : "private-secret" }, { status }); });
  for (const failure of [429, 500, 503]) {
    status = failure;
    await assert.rejects(refreshGoogleTokens(original, config), (error: unknown) => error instanceof GoogleError && error.retryable && !error.reconnectNeeded && !error.message.includes("private"));
    assert.equal(original.accessToken, "old-access");
  }
  assert.equal(calls, 3, "no hidden retries amplify quota");
  status = 200;
  const refreshed = await refreshGoogleTokens(original, config);
  assert.equal(refreshed.accessToken, "new-access");
  assert.equal(refreshed.refreshToken, original.refreshToken);
  assert.equal(refreshed.sessionId, original.sessionId);
  status = 400;
  await assert.rejects(refreshGoogleTokens(original, config), (error: unknown) => error instanceof GoogleError && error.reconnectNeeded && !error.retryable);
});

test("timeouts are retryable and upstream failures never leak diagnostics", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("private transport detail", "TimeoutError"); });
  await assert.rejects(fetchGoogleJson("https://oauth2.googleapis.com/token"), (error: unknown) => error instanceof GoogleError && error.retryable && !error.message.includes("private"));
});

test("insights merge prior-only rows and zero baselines without inventing infinite growth", () => {
  const row = (key: string, clicks: number) => ({ keys: [key], clicks, impressions: 200, position: 4 });
  const rows = mergeSearchInsights([row("current", 10), row("shared", 15)], [row("shared", 30), row("lost", 20)]);
  assert.equal(rows.find(row => row.key === "shared")?.clickChangePercent, -50);
  assert.equal(rows.find(row => row.key === "lost")?.clickChangePercent, null);
  assert.equal(rows.find(row => row.key === "lost")?.currentObserved, false);
  assert.equal(rows.find(row => row.key === "current")?.previousObserved, false);
  assert.equal(rows.find(row => row.key === "current")?.clickChangePercent, null);
  assert.equal(percentChange(0, 0), null);
});

test("encrypted vault is atomic, rejects wrong keys, and clears using an isolated temporary location", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omnirush", "seo-command-center-vault-test-"));
  const destination = path.join(directory, "google-session.enc");
  try {
    const tokens = parseTokens({ access_token: "private-access", refresh_token: "private-refresh", token_type: "Bearer", expires_in: 3600 });
    await writeGoogleVault(tokens, key, destination);
    assert.deepEqual(await readGoogleVault(key, destination), tokens);
    assert.ok(!(await readFile(destination, "utf8")).includes("private"));
    assert.equal(await readGoogleVault("cd".repeat(32), destination), undefined);
    await writeGoogleVault({ ...tokens, accessToken: "replacement" }, key, destination);
    assert.equal((await readGoogleVault(key, destination))?.accessToken, "replacement");
    assert.deepEqual(await readdir(directory), ["google-session.enc"]);
    await clearGoogleVault(destination);
    assert.equal(await readGoogleVault(key, destination), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("single-service property listing does not request the ungranted service", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => { urls.push(input); return Response.json({ siteEntry: [] }); });
  await googleProperties("token", { gsc: true, ga4: false });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("webmasters"));
});

test("server refresh preserves encrypted session on transient errors and clears revoked grants", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omnirush", "seo-command-center-refresh-test-"));
  const destination = path.join(directory, "google-session.enc");
  const config = { clientId: "id", clientSecret: "secret", key, baseUrl: "http://localhost:3000" };
  let status = 503;
  t.mock.method(globalThis, "fetch", async () => status === 200 ? Response.json({ access_token: "new-access", token_type: "Bearer", expires_in: 1 }) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"error":"invalid_')); controller.enqueue(new TextEncoder().encode('grant","error_description":"private"}')); controller.close(); } }), { status }));
  try {
    const tokens = parseTokens({ access_token: "old-access", refresh_token: "refresh", token_type: "Bearer", expires_in: 1 });
    await writeGoogleVault(tokens, key, destination);
    await assert.rejects(refreshStoredGoogleSession(config, destination), (error: unknown) => error instanceof GoogleError && error.retryable);
    assert.deepEqual(await readGoogleVault(key, destination), tokens);
    status = 200;
    await refreshStoredGoogleSession(config, destination);
    assert.equal((await readGoogleVault(key, destination))?.accessToken, "new-access");
    status = 400;
    await assert.rejects(refreshStoredGoogleSession(config, destination), (error: unknown) => error instanceof GoogleError && error.reconnectNeeded);
    assert.equal(await readGoogleVault(key, destination), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing Analytics metrics are errors, while explicit empty rows are zero", async (t) => {
  let response: unknown = {};
  t.mock.method(globalThis, "fetch", async () => Response.json(response));
  assert.equal((await googleReport("token", { propertyId: "123", days: 7 })).ga4, undefined);
  response = { rows: [{ metricValues: [{ value: "1" }] }] };
  assert.equal((await googleReport("token", { propertyId: "123", days: 7 })).ga4, undefined);
  response = { rowCount: 0 };
  assert.equal((await googleReport("token", { propertyId: "123", days: 7 })).ga4?.sessions, 0);
});

test("Analytics account summaries pagination is followed and normalized", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    urls.push(input);
    if (input.includes("webmasters")) return Response.json({ siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] });
    return Response.json({ accountSummaries: [{ propertySummaries: [{ property: input.includes("pageToken") ? "properties/456" : "properties/123", displayName: "Test property" }] }], ...(!input.includes("pageToken") ? { nextPageToken: "next token" } : {}) });
  });
  const result = await googleProperties("private-token");
  assert.deepEqual(result.ga4.map(property => property.id), ["123", "456"]);
  assert.equal(result.gsc[0].permissionLevel, "siteOwner");
  assert.equal(urls.length, 3);
});
