export class WorkspaceError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function assertWorkspaceRequest(request: Request, mutation = false): void {
  if (process.env.VERCEL === "1") {
    const host = request.headers.get("host");
    let origin: URL;
    try { origin = new URL(request.url); } catch { throw new WorkspaceError("Invalid deployment URL.", 403); }
    if (!host || !["http:", "https:"].includes(origin.protocol) || origin.host.toLowerCase() !== host.toLowerCase() || origin.username || origin.password) throw new WorkspaceError("Workspace access requires the deployed app host.", 403);
    const supplied = request.headers.get("origin");
    if ((supplied && supplied !== origin.origin) || (mutation && supplied !== origin.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new WorkspaceError("A same-origin request is required.", 403);
    return;
  }
  const host = request.headers.get("host");
  let origin: URL;
  try { origin = new URL(`${new URL(request.url).protocol}//${host}`); } catch { throw new WorkspaceError("Invalid local host.", 403); }
  if (!host || !["http:", "https:"].includes(origin.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.host !== host || origin.username || origin.password || origin.pathname !== "/") throw new WorkspaceError("Workspace access requires the local app host.", 403);
  const supplied = request.headers.get("origin");
  if ((supplied && supplied !== origin.origin) || (mutation && supplied !== origin.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new WorkspaceError("A same-origin request is required.", 403);
}
export function assertSocialRequest(request: Request, mutation = false): void {
  if (process.env.VERCEL !== "1") { assertWorkspaceRequest(request, mutation); return; }
  const host = request.headers.get("host");
  let requestUrl: URL;
  try { requestUrl = new URL(request.url); } catch { throw new WorkspaceError("Invalid deployment URL.", 403); }
  if (!host || !["http:", "https:"].includes(requestUrl.protocol) || requestUrl.host !== host || requestUrl.username || requestUrl.password) throw new WorkspaceError("Signal access requires the deployed app host.", 403);
  const supplied = request.headers.get("origin");
  if ((supplied && supplied !== requestUrl.origin) || (mutation && supplied !== requestUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new WorkspaceError("A same-origin request is required.", 403);
}
export async function readWorkspaceBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new WorkspaceError("JSON is required.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("A request body is required.");
  const chunks: Uint8Array[] = []; let length = 0;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new WorkspaceError("Request body timed out.", 408)); }, 15000); });
  try {
    await Promise.race([deadline, (async () => {
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 26 * 1024 * 1024) { await reader.cancel(); throw new WorkspaceError("Request exceeds the 25 MB backup limit plus its envelope.", 413); } chunks.push(part.value); }
    })()]);
  } finally { clearTimeout(timer!); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new WorkspaceError("Invalid JSON."); }
  const action = value && typeof value === "object" && "action" in value ? value.action : undefined;
  const limit = action === "restore" ? 26 * 1024 * 1024 : action === "import-screaming-frog" ? 16 * 1024 * 1024 : action === "import-legacy" || action === "save-report" || action === "hydrate-and-dispatch" ? 6 * 1024 * 1024 : 256 * 1024;
  if (length > limit) throw new WorkspaceError("Request is too large for this action.", 413);
  return value;
}
