import { randomBytes } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const callback = "http://localhost:3000/api/google/callback";

export function validateClient(document, expectedId) {
  const client = document?.web;
  if (!client || typeof client !== "object") throw new Error("Download a Web application OAuth client JSON, not a desktop client or service-account key.");
  if (typeof client.client_id !== "string" || !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(client.client_id)) throw new Error("The JSON does not contain a valid Google OAuth client ID.");
  if (expectedId && client.client_id !== expectedId) throw new Error("The downloaded client does not match the Orbit client. No configuration was written.");
  if (typeof client.client_secret !== "string" || !/^[a-zA-Z0-9_-]{12,512}$/.test(client.client_secret)) throw new Error("The JSON does not contain a usable client secret. Download a JSON containing an active secret.");
  if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(callback)) throw new Error(`The downloaded client is missing the required callback: ${callback}. Correct the redirect URI in Google Cloud before importing.`);
  return { id: client.client_id, secret: client.client_secret };
}

async function configure(source, expectedId) {
  if (!source || !path.isAbsolute(source)) throw new Error("Provide the full quoted path to the downloaded OAuth JSON.");
  const info = await stat(source);
  if (!info.isFile() || info.size > 65536) throw new Error("Expected a small OAuth JSON file.");
  let document;
  try { document = JSON.parse(await readFile(source, "utf8")); }
  catch { throw new Error("Could not parse the OAuth JSON; its contents have not been logged."); }
  const client = validateClient(document, expectedId);
  const encryptionKey = randomBytes(32).toString("hex");
  const contents = [
    "# Private local configuration. Never commit or share this file.",
    `GOOGLE_CLIENT_ID=${client.id}`,
    `GOOGLE_CLIENT_SECRET=${client.secret}`,
    "APP_BASE_URL=http://localhost:3000",
    `TOKEN_ENCRYPTION_KEY=${encryptionKey}`,
    "",
  ].join("\n");
  // Exclusive creation prevents accidental replacement of existing private configuration.
  await writeFile(path.join(root, ".env.local"), contents, { flag: "wx", mode: 0o600 });
  console.log("Google OAuth configuration saved to .env.local. No credential values were logged.");
  console.log("Verified: Web application client, matching client ID, required localhost callback, and client secret present.");
  console.log("Generated a fresh 256-bit encryption key. Restart the app to load the configuration.");
}

function selfTest() {
  const fixture = { web: { client_id: "test-client.apps.googleusercontent.com", client_secret: "test-placeholder-not-a-real-secret", redirect_uris: [callback] } };
  assert.equal(validateClient(fixture, fixture.web.client_id).id, fixture.web.client_id);
  assert.throws(() => validateClient({ installed: fixture.web }), /Web application/);
  assert.throws(() => validateClient(fixture, "wrong-client"), /does not match/);
  assert.throws(() => validateClient({ web: { ...fixture.web, redirect_uris: [] } }), /missing the required callback/);
  assert.throws(() => validateClient({ web: { ...fixture.web, client_secret: "bad\nINJECT=value" } }), /usable client secret/);
  assert.throws(() => validateClient({ web: { ...fixture.web, client_secret: undefined } }), /usable client secret/);
  console.log("PASS: OAuth importer validation (valid client, type, identity, callback, missing secret, newline injection).");
}

if (process.argv[2] === "--self-test") selfTest();
else configure(process.argv[2], process.argv[3]).catch(error => {
  const code = error?.code;
  const message = code === "EEXIST" ? ".env.local already exists; no changes made." : code === "ENOENT" ? "The OAuth file or destination directory does not exist. Check the full quoted path." : code === "EACCES" || code === "EPERM" ? "File access was denied. Authorize the source folder before importing." : error instanceof Error ? error.message : "Configuration failed.";
  console.error(message);
  process.exitCode = 1;
});
