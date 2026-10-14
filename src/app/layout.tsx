import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import ClerkAccountControl from "./clerk-account-control";
import "./globals.css";
import "./access.css";
import "./local.css";
import "./local-preview.css";
import "./social.css";
import "./live.css";
import "./ui-polish.css";
import "./brand-refresh.css";

export const metadata: Metadata = {
  title: "SIGNAL — Social media operations",
  description: "A focused workspace for managing social media across client accounts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const clerkReady = process.env.CLERK_AUTH_ENABLED === "1" && process.env.CLERK_ORG_STORAGE_READY === "1" && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
  return <html lang="en"><body>{clerkReady ? <ClerkProvider><ClerkAccountControl />{children}</ClerkProvider> : children}</body></html>;
}
