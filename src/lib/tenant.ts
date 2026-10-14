import { auth } from "@clerk/nextjs/server";
import { AsyncLocalStorage } from "node:async_hooks";
import { WorkspaceError } from "./api-security";

export type TenantContext = { organizationId: string; userId: string; role: string | null };

export const LEGACY_TENANT_ID = "legacy";
export const LOCAL_TENANT_ID = "local";
const tenantScope = new AsyncLocalStorage<string>();

export function withTenantId<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
  return tenantScope.run(tenantId, operation);
}

export async function currentTenantId(): Promise<string> {
  const scoped = tenantScope.getStore();
  if (scoped) return scoped;
  const clerkActive = process.env.CLERK_AUTH_ENABLED === "1" && process.env.CLERK_ORG_STORAGE_READY === "1" && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
  if (clerkActive) return (await requireTenantContext()).organizationId;
  return process.env.VERCEL === "1" ? LEGACY_TENANT_ID : LOCAL_TENANT_ID;
}

/** Returns the verified Clerk organization for this server request. */
export async function requireTenantContext(): Promise<TenantContext> {
  const session = await auth();
  if (!session.userId) throw new WorkspaceError("Sign in to access this workspace.", 401);
  if (!session.orgId) throw new WorkspaceError("Choose or create an organization first.", 403);
  return { organizationId: session.orgId, userId: session.userId, role: session.orgRole ?? null };
}

export async function requireOrganizationAdmin(): Promise<TenantContext> {
  const context = await requireTenantContext();
  if (context.role !== "org:admin" && context.role !== "org:owner") throw new WorkspaceError("Organization administrator access is required for campaign changes.", 403);
  return context;
}
