import type { Metadata } from "next";
import LocalDashboard from "../local-dashboard";

export const metadata: Metadata = {
  title: "LocalPilot — Local service growth engine",
  description: "Programmatic local landing pages, Google Business Profile sync, and lead tracking for service businesses.",
};

export default function LocalPage() {
  return <LocalDashboard />;
}
