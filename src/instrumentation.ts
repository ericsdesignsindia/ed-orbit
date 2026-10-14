export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build" && process.env.VERCEL !== "1") {
    const { ensureRunner } = await import("./lib/jobs");
    ensureRunner();
  }
}
