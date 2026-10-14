import AccessForm from "../access-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const candidate = params.next ?? "/";
  const nextPath = candidate.startsWith("/") && !candidate.startsWith("//") && !["/login", "/setup", "/api/auth"].includes(candidate) ? candidate : "/";
  return <AccessForm nextPath={nextPath} />;
}
