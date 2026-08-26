import { redirect } from "next/navigation";
import { MorningMeeting } from "@/components/MorningMeeting";
import { Empty } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import type { MeetingBoard, Team, User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MorningPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");
  if (!user.is_owner) redirect("/my-day");

  const { team: requested } = await searchParams;

  let teams: Team[] = [];
  try {
    teams = await api.get<Team[]>("/api/teams/");
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/sign-in?next=/morning");
    }
    throw err;
  }

  if (teams.length === 0) {
    return (
      <>
        <header className="page-head dawn">
          <div className="stack gap-2">
            <span className="eyebrow">Morning meeting</span>
            <h1>You need a team first.</h1>
          </div>
        </header>
        <div className="page-body">
          <div className="panel">
            <Empty
              title="No team to meet with"
              body="Build a team from people who have signed up, then come back and run the round."
            />
          </div>
        </div>
      </>
    );
  }

  const team = teams.find((t) => String(t.id) === requested) ?? teams[0];
  const board = await api.get<MeetingBoard>(`/api/daily/meeting/${team.id}`);

  return <MorningMeeting board={board} teams={teams} activeTeam={team} />;
}
