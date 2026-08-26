import Link from "next/link";
import { redirect } from "next/navigation";
import { InviteLinks } from "@/components/InviteLinks";
import { TeamBuilder } from "@/components/TeamBuilder";
import { Avatar, Empty, Thread } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import { plural } from "@/lib/format";
import type { Dashboard, Team, User } from "@/lib/types";

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

  const workload = new Map(dashboard?.workload.map((w) => [w.user.id, w]) ?? []);
  const headcount = teams.reduce((sum, t) => sum + t.member_count, 0);

  return (
    <>
      <header className="page-head dawn">
        <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
          <div className="stack gap-2">
            <span className="eyebrow">Team</span>
            <h1>{headcount} {plural(headcount, "person", "people")} on your teams</h1>
            <p className="soft" style={{ fontSize: ".93rem", maxWidth: "52ch" }}>
              Everyone here has signed up already. Open somebody to see what they are
              carrying and how their days have gone.
            </p>
          </div>
          <TeamBuilder teams={teams} />
        </div>
      </header>

      <div className="page-body">
        {teams.length === 0 && (
          <div className="panel">
            <Empty
              title="No team yet"
              body="Create a team, then add people who have signed up. You draw project members from it."
            />
          </div>
        )}

        {teams.map((team) => (
          <section key={team.id} className="stack gap-3">
            <div className="row between center wrap gap-2">
              <div className="stack gap-1">
                <h2>{team.name}</h2>
                {team.description && (
                  <span className="faint" style={{ fontSize: ".82rem" }}>{team.description}</span>
                )}
              </div>
              <span className="eyebrow">{team.member_count} {plural(team.member_count, "member")}</span>
            </div>

            <InviteLinks team={team} />

            <div className="grid cols-auto">
              {team.members.map((membership, index) => {
                const person = membership.user;
                const load = workload.get(person.id);
                return (
                  <Link key={membership.id} href={`/team/${person.id}`}
                        className="panel stack gap-3 rise"
                        style={{ padding: 17, animationDelay: `${index * 45}ms` }}>
                    <div className="row gap-3 center">
                      <Avatar name={person.display_name} large
                              url={person.gitlab_avatar_url || undefined} />
                      <span className="stack grow">
                        <span style={{ fontWeight: 600, fontSize: ".95rem" }}>
                          {person.display_name}
                        </span>
                        <span className="faint" style={{ fontSize: ".77rem" }}>
                          {person.job_title || person.department}
                        </span>
                      </span>
                      {(load?.todos_stale ?? 0) > 0 && (
                        <Thread days={(load?.todos_stale ?? 0) + 2} stale />
                      )}
                    </div>

                    {load && (
                      <div className="row gap-4 wrap" style={{ fontSize: ".76rem" }}>
                        <span className="stack">
                          <span className="mono" style={{ fontSize: ".95rem", fontWeight: 600 }}>
                            {load.open_tasks}
                          </span>
                          <span className="faint">open tasks</span>
                        </span>
                        <span className="stack">
                          <span className="mono" style={{ fontSize: ".95rem", fontWeight: 600,
                                        color: load.overdue_tasks ? "var(--overdue)" : undefined }}>
                            {load.overdue_tasks}
                          </span>
                          <span className="faint">overdue</span>
                        </span>
                        <span className="stack">
                          <span className="mono" style={{ fontSize: ".95rem", fontWeight: 600 }}>
                            {load.todos_total - load.todos_pending}/{load.todos_total}
                          </span>
                          <span className="faint">done today</span>
                        </span>
                        <span className="stack">
                          <span className="mono" style={{ fontSize: ".95rem", fontWeight: 600 }}>
                            {load.project_count}
                          </span>
                          <span className="faint">projects</span>
                        </span>
                      </div>
                    )}
                  </Link>
                );
              })}

              {team.members.length === 0 && (
                <div className="panel" style={{ gridColumn: "1 / -1" }}>
                  <Empty title="Nobody on this team yet"
                         body="Add people who have already signed up — we need their GitLab account to assign them anything." />
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
