import { redirect } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { api, currentUser } from "@/lib/api";
import type { AuthConfig, User } from "@/lib/types";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  oauth_failed:
    "GitLab turned the sign-in down. Check that the application's redirect URI matches GITLAB_OAUTH_REDIRECT_URI exactly, including the port.",
  missing_code_or_state:
    "GitLab came back without an authorization code. Start the sign-in again.",
  access_denied: "You declined the authorization request.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  const user = await currentUser<User>();
  if (user) redirect(user.is_onboarded ? (user.is_owner ? "/" : "/my-day") : "/welcome");

  let config: AuthConfig | null = null;
  try {
    config = await api.get<AuthConfig>("/api/auth/config");
  } catch {
    config = null;
  }

  return (
    <SignIn
      config={config}
      error={error ? (ERRORS[error] ?? error) : null}
      next={next ?? "/"}
    />
  );
}
