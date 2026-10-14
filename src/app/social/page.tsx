import type { Metadata } from "next";
import SocialDashboard from "../social-dashboard";

export const metadata: Metadata = {
  title: "Signal — Social media operations",
  description: "A focused workspace for managing social media across client accounts.",
};

export default function SocialPage() {
  return <SocialDashboard showSeoLink hosted={process.env.VERCEL === "1"} />;
}
