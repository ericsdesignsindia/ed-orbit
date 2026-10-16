import type { Metadata } from "next";
import LiveDashboard from "../live-dashboard";

export const metadata: Metadata = {
  title: "SEO Performance | SIGNAL",
  description: "Review live organic search performance, query insights, technical findings, and website reports in SIGNAL.",
};

export default function SeoPage() {
  return <LiveDashboard hosted={process.env.VERCEL === "1"} />;
}
