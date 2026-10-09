import LoginForm from "@/components/site/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return <LoginForm initialError={!!sp.error} />;
}
