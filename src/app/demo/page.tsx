import type { Metadata } from "next";
import SignalDemo from "./signal-demo";
import "./signal-demo.css";

export const metadata: Metadata = {
  title: "SIGNAL — Interactive demo",
  description: "Explore the SIGNAL social media management workspace.",
};

export default function DemoPage() {
  return <SignalDemo />;
}
