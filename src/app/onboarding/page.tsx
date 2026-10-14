import { CreateOrganization } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function OrganizationOnboardingPage() {
  return <main className="clerk-auth-page"><section className="clerk-onboarding"><p className="eyebrow">SET UP YOUR AGENCY</p><h1>Create your workspace</h1><p>Your organization keeps your team and customer data separate.</p><CreateOrganization afterCreateOrganizationUrl="/" /></section></main>;
}
