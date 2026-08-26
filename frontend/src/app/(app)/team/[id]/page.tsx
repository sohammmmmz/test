import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TodoList } from "@/components/TodoList";
import { Avatar, Empty, Thread } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import { longDate, plural, relativeDue, shortDate, weekday } from "@/lib/format";
import type { DayView, Project, Todo, User } from "@/lib/types";

export const dynamic = "force-dynamic";

type History = {
  user: User;
  days: number;
  history: { date: string; total: number; done: number; todos: Todo[] }[];
};

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await currentUser<User>();
  if (!me) redirect("/sign-in");
  if (!me.is_owner) redirect("/my-day");

  let day: DayView;
  let history: History | null = null;
  let projects: Project[] = [];
  try {
    [day, history, projects] = await Promise.all([
      api.get<DayView>(`/api/daily/people/${id}/day`),
      api.get<History>(`/api/daily/people/${id}/history?days=21`).catch(() => null),
      api.get<Project[]>("/api/projects/").catch(() => []),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="page-body">
          <Empty title="Not your team member"
                 body="You can only open people on a team you own." />
        </div>
      );
    }
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    throw err;
  }

  const person = day.user!;
  const theirProjects = projects.filter((p) =>
    p.owner.id === person.id || (history && true),
  );
  const owned = projects.filter((p) => p.owner.id === person.id);
  const openTasks = day.open_tasks ?? [];

  // Days they actually had a list, most recent first, today excluded — today is
  // already shown in full above.
  const past = (history?.history ?? []).filter((h) => h.date !== day.date);

  return (
    <>
      <header className="page-head dawn">
        <div className="stack gap-3">
          <Link href="/team" className="eyebrow" style={{ color: "var(--brand)" }}>
            ← Team
          </Link>
          <div className="row gap-4 center wrap">
            <Avatar name={person.display_name} large
                    url={person.gitlab_avatar_url || undefined} />
            <div className="stack gap-1 grow">
              <h1 style={{ fontSize: "clamp(1.6rem, 3vw, 2.1rem)" }}>{person.display_name}</h1>
              <span className="soft" style={{ fontSize: ".9rem" }}>
                {person.job_title || person.department}
                {person.gitlab_username && (
                  <span className="mono faint"> · @{person.gitlab_username}</span>
                )}
              </span>
            </div>
            <div className="row gap-5">
              <span className="stack">
                <span className="mono" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                  {openTasks.length}
                </span>
                <span className="eyebrow">open tasks</span>
              </span>
              <span className="stack">
                <span className="mono" style={{ fontSize: "1.5rem", fontWeight: 600,
                              color: day.counts.stale ? "var(--attention)" : undefined }}>
                  {day.counts.stale}
                </span>
                <span className="eyebrow">carrying</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="page-body">

        <section className="grid cols-2" style={{ alignItems: "start" }}>
          <TodoList
            todos={day.todos}
            suggestions={day.suggestions}
            date={day.date}
            userId={person.id}
            canAdd
            canTick
            title={`${weekday(day.date)}'s list`}
          />

          <div className="stack gap-4">
            {owned.length > 0 && (
              <div className="panel rise" style={{ overflow: "hidden" }}>
                <div className="panel-head">
                  <h2 style={{ fontSize: "1rem" }}>Owns</h2>
                </div>
                <div className="stack">
                  {owned.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}`}
                          className="row between center"
                          style={{ padding: "11px 18px", borderBottom: "1px solid var(--line)" }}>
                      <span style={{ fontSize: ".87rem", fontWeight: 500 }}>{p.name}</span>
                      <span className="mono faint" style={{ fontSize: ".74rem" }}>
                        {p.progress.percent}%
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="panel rise" style={{ overflow: "hidden", animationDelay: "60ms" }}>
              <div className="panel-head">
                <h2 style={{ fontSize: "1rem" }}>Open tasks</h2>
                <span className="eyebrow">{openTasks.length}</span>
              </div>
              <div className="stack">
                {openTasks.slice(0, 8).map((task) => (
                  <div key={task.id} className="row between gap-3 center"
                       style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)" }}>
                    <span className="stack grow">
                      <span style={{ fontSize: ".85rem" }}>{task.title}</span>
                      <span className="mono faint" style={{ fontSize: ".72rem" }}>
                        {task.project_name}
                      </span>
                    </span>
                    <span className="mono" style={{ fontSize: ".74rem",
                                  color: task.is_overdue ? "var(--overdue)" : "var(--ink-faint)" }}>
                      {relativeDue(task.due_date)}
                    </span>
                  </div>
                ))}
                {openTasks.length === 0 && (
                  <p className="faint" style={{ padding: "18px", fontSize: ".85rem" }}>
                    Nothing assigned in GitLab right now.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="stack gap-3">
          <div className="stack gap-1">
            <h2>How the days have gone</h2>
            <span className="faint" style={{ fontSize: ".82rem" }}>
              The last three weeks. A thread beside a line shows how long it had
              been carried by that day.
            </span>
          </div>

          {past.length === 0 ? (
            <div className="panel">
              <Empty title="No history yet"
                     body="Once a few days have passed, what was on the list each morning shows up here." />
            </div>
          ) : (
            <div className="stack gap-3">
              {past.map((entry, index) => (
                <div key={entry.date} className="panel rise"
                     style={{ overflow: "hidden", animationDelay: `${index * 40}ms` }}>
                  <div className="panel-head" style={{ padding: "10px 18px" }}>
                    <div className="row gap-2 center">
                      <span style={{ fontSize: ".87rem", fontWeight: 600 }}>
                        {weekday(entry.date)}
                      </span>
                      <span className="mono faint" style={{ fontSize: ".76rem" }}>
                        {shortDate(entry.date)}
                      </span>
                    </div>
                    <span className="mono faint" style={{ fontSize: ".76rem" }}>
                      {entry.done}/{entry.total} done
                    </span>
                  </div>
                  <div className="stack">
                    {entry.todos.map((todo) => (
                      <div key={todo.id} className="todo" data-done={todo.is_done}
                           style={{ padding: "8px 16px" }}>
                        <span className="check" data-done={todo.is_done} aria-hidden
                              style={{ width: 15, height: 15 }}>
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                            <path d="M2.5 6.4l2.4 2.4L9.6 3.6" stroke="#fff" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        <Thread days={todo.carry_count} stale={todo.is_stale} />
                        <span className="grow todo-title" style={{ fontSize: ".84rem" }}>
                          {todo.title}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
