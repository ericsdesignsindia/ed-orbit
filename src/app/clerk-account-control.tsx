"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";

export default function ClerkAccountControl() {
  const pathname = usePathname();
  if (pathname === "/demo") return null;
  return <div className="clerk-account-control" aria-label="Account and workspace menu"><OrganizationSwitcher afterCreateOrganizationUrl="/" afterSelectOrganizationUrl="/" /><UserButton /></div>;
}
