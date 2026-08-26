import { redirect } from "next/navigation";
import { SignIn } from "@/components/SignIn";
import { Empty } from "@/components/ui";
import { api, currentUser } from "@/lib/api";
import type { AuthConfig, InviteDetails, User } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The other end of a team invite link.
 *
 * The same sign-in screen, told which team it is joining. Signing in with
 * GitLab and joining the team are one act: the token rides through the
 * handshake and is redeemed on the way back.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let invite: InviteDetails | null = null;
  try {
    invite = await api.get<InviteDetails>(`/api/teams/invites/${token}/`);
  } catch {
    invite = null;
  }

  // Somebody already signed in does not need the sign-in screen — send them
  // where they were going and let the app decide what they can see.
  const user = await currentUser<User>();
  if (user?.is_onboarded) redirect(user.is_owner ? "/" : "/my-day");

  if (!invite || !invite.valid) {
    return (
      <main
        className="dawn"
        style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}
      >
        <div className="panel" style={{ maxWidth: 440, width: "100%" }}>
          <Empty
            title={
              invite?.reason === "expired"
                ? "This invite has expired"
                : invite?.reason === "used up"
                  ? "This invite has been used up"
                  : invite?.reason === "revoked"
                    ? "This invite was turned off"
                    : "That invite link is not recognised"
            }
            body={
              invite?.team
                ? `Ask ${invite.invited_by} for a new link to ${invite.team}.`
                : "Check the link, or ask whoever sent it for a fresh one."
            }
          />
        </div>
      </main>
    );
  }

  const config = await api.get<AuthConfig>("/api/auth/config").catch(() => null);

  return (
    <SignIn
      config={config}
      error={null}
      next="/my-day"
      invite={token}
      team={invite.team}
    />
  );
}
