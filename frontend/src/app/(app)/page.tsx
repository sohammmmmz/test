import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, Empty, Meter, StatTile, Thread } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import { longDate, plural, relativeDue, weekday } from "@/lib/format";
import type { Alerts, Dashboard, User } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Today.
 *
 * Opens on the one sentence that decides whether the rest of the screen is
 * worth reading — what needs the manager before standup. Everything below is
 * the evidence for it, in the order it would be acted on.
 */
export default async function TodayPage() {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");
  if (!user.is_owner) redirect("/my-day");

  let data: Dashboard;
  let alerts: Alerts | null = null;
  try {
    [data, alerts] = await Promise.all([
      api.get<Dashboard>("/api/dashboard"),
      // Your own list is additive here; a failure must not take the team view
      // down with it.
      api.get<Alerts>("/api/daily/my-alerts").catch(() => null),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/sign-in?next=/");
    }
    return (
      <div className="page-body">
        <Empty
          title="The server is not responding"
          body="Django should be running on port 8000. Check its logs, then reload this page."
        />
      </div>
    );
  }

  const { totals } = data;
  const needsAttention = totals.slipping + totals.not_ready;
  const myPending = alerts?.pending_count ?? 0;
  const myStale = alerts?.stale.length ?? 0;

  const headline =
    needsAttention === 0 && myPending === 0
      ? "Nothing is asking for you. Good morning."
      : needsAttention === 0
        ? `${myPending} ${plural(myPending, "thing")} on your own list.`
        : `${needsAttention} ${plural(needsAttention, "project needs", "projects need")} you.`;

  return (
    <>
      <header className="page-head dawn">
        <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
          <div className="stack gap-2">
            <span className="eyebrow">
              {weekday(data.date)} · {longDate(data.date)}
            </span>
            <h1 style={{ maxWidth: "18ch" }}>{headline}</h1>
            <p className="soft" style={{ fontSize: ".93rem", maxWidth: "52ch" }}>
              {totals.people} on the team, {totals.open_tasks} open{" "}
              {plural(totals.open_tasks, "task")} across {totals.projects}{" "}
              {plural(totals.projects, "project")}.
            </p>
          </div>
          <Link href="/morning" className="btn btn-primary btn-lg">
            Go to the morning meeting
          </Link>
        </div>
      </header>

      <div className="page-body">

        <section className="grid cols-stat">
          <StatTile label="Projects" value={totals.projects}
                    hint={`${totals.active_projects} active`} index={0} />
          <StatTile label="Slipping" value={totals.slipping}
                    hint="past a milestone date"
                    tone={totals.slipping ? "var(--overdue)" : undefined} index={1} />
          <StatTile label="Not set up" value={totals.not_ready}
                    hint="missing docs or dates"
                    tone={totals.not_ready ? "var(--attention)" : undefined} index={2} />
          <StatTile label="Open tasks" value={totals.open_tasks}
                    hint="assigned across the team" index={3} />
        </section>

        {alerts && (myPending > 0 || alerts.overdue_tasks.length > 0) && (
          <section className="panel rise" style={{ animationDelay: "180ms" }}>
            <div className="panel-head">
              <div className="stack">
                <h2 style={{ fontSize: "1.05rem" }}>Your own day</h2>
                <span className="faint" style={{ fontSize: ".78rem" }}>
                  Running the team is the easiest way to lose sight of your own work.
                </span>
              </div>
              <Link href="/my-day" className="btn btn-sm">Open my day</Link>
            </div>

            {myStale > 0 && (
              <div className="row gap-2 center"
                   style={{ padding: "10px 18px", background: "var(--attention-wash)",
                            color: "var(--attention)", fontSize: ".83rem" }}>
                <span className="dot pulse-dot" style={{ background: "currentColor" }} />
                {myStale} {plural(myStale, "item has", "items have")} been carrying for days.
              </div>
            )}

            <div className="locked-body stack" style={{ maxHeight: "18rem" }}>
              {alerts.pending.slice(0, 5).map((todo) => (
                <div key={todo.id} className="todo">
                  <Thread days={todo.carry_count} stale={todo.is_stale} />
                  <span className="grow todo-title">{todo.title}</span>
                  {todo.task && (
                    <span className="pill pill-brand">#{todo.task.gitlab_iid}</span>
                  )}
                </div>
              ))}
              {alerts.overdue_tasks.slice(0, 3).map((task) => (
                <div key={`t${task.id}`} className="todo">
                  <span className="thread" />
                  <span className="grow todo-title">{task.title}</span>
                  <span className="pill pill-overdue">{relativeDue(task.due_date)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="grid cols-2" style={{ alignItems: "start" }}>
          {/* Locked height, scrolling inside. Both of these grow with the team
              and with the plan; letting either set the page height means the
              layout comes apart on the day somebody hires. */}
          <div className="panel rise panel-locked" style={{ animationDelay: "220ms" }}>
            <div className="panel-head">
              <h2 style={{ fontSize: "1.05rem" }}>Who is carrying what</h2>
              <span className="eyebrow">
                {data.workload.length} {plural(data.workload.length, "person", "people")} · busiest first
              </span>
            </div>
            <div className="locked-body scroll-x">
              <table className="data" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Open</th>
                    <th>Overdue</th>
                    <th>Today</th>
                    <th>Carrying</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workload.map((row) => (
                    <tr key={row.user.id}>
                      <td>
                        <Link href={`/team/${row.user.id}`} className="row gap-2 center">
                          <Avatar name={row.user.display_name}
                                  url={row.user.gitlab_avatar_url || undefined} />
                          <span className="stack">
                            <span style={{ fontWeight: 500 }}>
                              {row.user.display_name}
                              {row.is_you && (
                                <span className="faint" style={{ fontWeight: 400 }}> · you</span>
                              )}
                            </span>
                            <span className="faint" style={{ fontSize: ".73rem" }}>
                              {row.user.job_title || row.user.department}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="mono">{row.open_tasks}</td>
                      <td className="mono"
                          style={{ color: row.overdue_tasks ? "var(--overdue)" : "var(--ink-faint)" }}>
                        {row.overdue_tasks || "—"}
                      </td>
                      <td className="mono">
                        {row.todos_total - row.todos_pending}<span className="faint">/{row.todos_total}</span>
                      </td>
                      <td>
                        {row.todos_stale > 0
                          ? <Thread days={row.todos_stale + 2} stale />
                          : <span className="faint">—</span>}
                      </td>
                    </tr>
                  ))}
                  {data.workload.length === 0 && (
                    <tr><td colSpan={5}>
                      <Empty title="No team yet"
                             body="Build a team and the people on it will show up here."
                             action={<Link href="/team" className="btn btn-sm">Build a team</Link>} />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel rise panel-locked" style={{ animationDelay: "260ms" }}>
            <div className="panel-head">
              <h2 style={{ fontSize: "1.05rem" }}>What lands next</h2>
              <span className="eyebrow">
                {data.upcoming_milestones.length} ahead · by date
              </span>
            </div>
            <div className="locked-body stack">
              {data.upcoming_milestones.map((m) => (
                <Link key={m.id} href={`/projects/${m.project_id}`}
                      className="stack gap-2"
                      style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)" }}>
                  <div className="row between gap-3">
                    <span style={{ fontSize: ".88rem", fontWeight: 500 }}>{m.title}</span>
                    <span className="pill"
                          style={m.is_overdue
                            ? { background: "var(--overdue-wash)", color: "var(--overdue)" }
                            : undefined}>
                      {relativeDue(m.due_date)}
                    </span>
                  </div>
                  <span className="faint" style={{ fontSize: ".76rem" }}>{m.project}</span>
                  <div className="row gap-2 center">
                    <Meter percent={m.total ? Math.round((m.done / m.total) * 100) : 0}
                           tone={m.is_overdue ? "late" : undefined} />
                    <span className="mono faint" style={{ fontSize: ".72rem" }}>
                      {m.done}/{m.total}
                    </span>
                  </div>
                </Link>
              ))}
              {data.upcoming_milestones.length === 0 && (
                <Empty title="Nothing scheduled"
                       body="Add a milestone with a due date and it will appear here." />
              )}
              <span style={{ height: 22, flex: "none" }} />
            </div>
          </div>
        </section>

        <section className="stack gap-3 rise" style={{ animationDelay: "300ms" }}>
          <div className="row between center">
            <h2>Projects</h2>
            <Link href="/projects" className="btn btn-sm">All projects</Link>
          </div>
          <div className="grid cols-auto">
            {data.projects.slice(0, 6).map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}
                    className="panel stack gap-3" style={{ padding: 17 }}>
                <div className="row between gap-2" style={{ alignItems: "flex-start" }}>
                  <span style={{ fontWeight: 600, fontSize: ".97rem",
                                 fontFamily: "var(--display)" }}>
                    {project.name}
                  </span>
                  {project.progress.is_slipping && (
                    <span className="pill pill-overdue">slipping</span>
                  )}
                </div>
                <span className="mono faint" style={{ fontSize: ".72rem" }}>
                  {project.repo_path ?? "no repository"}
                </span>
                <div className="stack gap-1">
                  <Meter percent={project.progress.percent}
                         tone={project.progress.is_slipping ? "late"
                               : project.progress.percent === 100 ? "done" : undefined} />
                  <div className="row between">
                    <span className="mono faint" style={{ fontSize: ".72rem" }}>
                      {project.progress.completed_tasks}/{project.progress.total_tasks} tasks
                    </span>
                    <span className="mono faint" style={{ fontSize: ".72rem" }}>
                      {project.readiness.passed}/4 set up
                    </span>
                  </div>
                </div>
              </Link>
            ))}
            {data.projects.length === 0 && (
              <div className="panel" style={{ gridColumn: "1 / -1" }}>
                <Empty
                  title="No projects yet"
                  body="Creating one here creates its GitLab repository, a branch for each member and a documentation branch."
                  action={<Link href="/projects" className="btn btn-primary btn-sm">Create a project</Link>}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
