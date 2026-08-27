import { redirect } from "next/navigation";
import { TeamBuilder } from "@/components/TeamBuilder";
import { TeamCard } from "@/components/TeamCard";
import { Empty } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import { plural } from "@/lib/format";
import type { Dashboard, Team, User, WorkloadRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");
  if (!user.is_owner) redirect("/my-day");

  let teams: Team[] = [];
  let dashboard: Dashboard | null = null;
  try {
    [teams, dashboard] = await Promise.all([
      api.get<Team[]>("/api/teams/"),
      api.get<Dashboard>("/api/dashboard").catch(() => null),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/sign-in?next=/team");
    }
    return (
      <div className="page-body">
        <Empty title="Could not load your team" body="The server did not respond." />
      </div>
    );
  }

  const workload: Record<number, WorkloadRow> = {};
  for (const row of dashboard?.workload ?? []) workload[row.user.id] = row;

  // Somebody on two teams is one person, not two. The headcount says how many
  // people the owner is actually responsible for.
  const everyone = new Set<number>();
  for (const team of teams) for (const m of team.members) everyone.add(m.user.id);
  const headcount = everyone.size;

  const onTeams = [...everyone].map((id) => workload[id]).filter(Boolean) as WorkloadRow[];
  const openTasks = onTeams.reduce((sum, r) => sum + r.open_tasks, 0);
  const overdue = onTeams.reduce((sum, r) => sum + r.overdue_tasks, 0);
  const carrying = onTeams.filter((r) => r.todos_stale > 0).length;

  return (
    <>
      <header className="page-head dawn">
        <div className="row between wrap gap-5" style={{ alignItems: "flex-end" }}>
          <div className="stack gap-3">
            <span className="eyebrow">Team strength</span>
            <div className="row gap-4" style={{ alignItems: "flex-end" }}>
              <span className="strength">{headcount}</span>
              <span className="stack gap-1" style={{ paddingBottom: 6 }}>
                <span style={{ fontSize: ".95rem", fontWeight: 600 }}>
                  {plural(headcount, "person", "people")}
                </span>
                <span className="faint" style={{ fontSize: ".8rem" }}>
                  across {teams.length} {plural(teams.length, "team")}
                </span>
              </span>
            </div>
            <div className="row gap-2 wrap center">
              <span className="pill pill-brand">{openTasks} open {plural(openTasks, "task")}</span>
              {overdue > 0 && <span className="pill pill-overdue">{overdue} overdue</span>}
              {carrying > 0 && (
                <span className="pill pill-attention">{carrying} carrying work over</span>
              )}
            </div>
          </div>

          <TeamBuilder hasTeams={teams.length > 0} />
        </div>
      </header>

      <div className="page-body">
        {teams.length === 0 ? (
          <div className="panel">
            <Empty
              title="No team yet"
              body="Create a team, then add people who have signed up or share a link so they can join. You draw project members from it."
            />
          </div>
        ) : (
          <div className="stack gap-4">
            {teams.map((team, index) => (
              <TeamCard key={team.id} team={team} workload={workload} index={index} />
            ))}
          </div>
        )}

        {teams.length > 0 && (
          <p className="faint" style={{ fontSize: ".78rem" }}>
            Open a team to see everyone on it. Open a person to see what they are
            carrying and how their days have gone.
          </p>
        )}
      </div>
    </>
  );
}
