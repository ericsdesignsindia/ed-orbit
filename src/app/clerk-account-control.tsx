"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

export default function ClerkAccountControl() {
  return <div className="clerk-account-control" aria-label="Account and workspace menu"><OrganizationSwitcher afterCreateOrganizationUrl="/" afterSelectOrganizationUrl="/" /><UserButton /></div>;
}
