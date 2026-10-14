import type { Metadata } from "next";
import SocialDashboard from "./social-dashboard";

export const metadata: Metadata = {
  title: "SIGNAL — Social media operations",
  description: "A focused workspace for managing social media across client accounts.",
};

export default function Home() {
  return <SocialDashboard showSeoLink hosted={process.env.VERCEL === "1"} />;
}
