import type { Metadata } from "next";
import LiveDashboard from "../live-dashboard";

export const metadata: Metadata = {
  title: "SEO Command Center",
  description: "A workspace for website audits, organic reporting, and SEO operations.",
};

export default function SeoPage() {
  return <LiveDashboard hosted={process.env.VERCEL === "1"} />;
}
