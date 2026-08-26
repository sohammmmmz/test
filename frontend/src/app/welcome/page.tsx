import { redirect } from "next/navigation";
import { Onboarding } from "@/components/Onboarding";
import { api, currentUser } from "@/lib/api";
import type { AuthConfig, User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");
  if (user.is_onboarded) redirect(user.is_owner ? "/" : "/my-day");

  const config = await api.get<AuthConfig>("/api/auth/config");
  return <Onboarding user={user} config={config} />;
}
