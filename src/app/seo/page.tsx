import type { Metadata } from "next";
import LiveDashboard from "../live-dashboard";

export const metadata: Metadata = {
  title: "Screaming Frog SEO workspace | SIGNAL",
  description: "Import Screaming Frog SEO Spider crawl exports, review issues, and keep crawl history with your organic search reports.",
};

export default function SeoPage() {
  return <LiveDashboard hosted={process.env.VERCEL === "1"} />;
}
