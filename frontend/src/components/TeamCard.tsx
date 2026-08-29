"use client";

import Link from "next/link";
import { useState } from "react";
import { InvitePeople } from "./InvitePeople";
import { Avatar, Empty, Thread } from "./ui";
import { plural } from "@/lib/format";
import type { Team, WorkloadRow } from "@/lib/types";

/**
 * One team, closed by default and opening in place.
 *
 * Opening in place rather than navigating is the point: an owner with three
 * teams is usually comparing them — who is loaded, who is carrying work over —
 * and a detail page can only ever show one at a time. Closed, the card answers
 * "how big is this team"; open, it answers "and how is everyone doing".
 */
export function TeamCard({ team, workload, index = 0 }: {
  team: Team;
  workload: Record<number, WorkloadRow>;
  index?: number;
}) {
  const [open, setOpen] = useState(false);

  const members = team.members;
  const faces = members.slice(0, 5);
  const spare = members.length - faces.length;

  // Rolled up from the people on this team, so the closed card still says
  // something about the state of the work and not only the headcount.
  const rows = members.map((m) => workload[m.user.id]).filter(Boolean) as WorkloadRow[];
  const openTasks = rows.reduce((sum, r) => sum + r.open_tasks, 0);
  const overdue = rows.reduce((sum, r) => sum + r.overdue_tasks, 0);
  const carrying = rows.filter((r) => r.todos_stale > 0).length;

  function toggle() {
    setOpen((current) => !current);
  }

  return (
    <article className="panel tcard rise" data-open={open}
             style={{ animationDelay: `${index * 70}ms` }}>
      <div
        className="tcard-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <div className="stack gap-1 grow" style={{ minWidth: 0 }}>
          <span className="row gap-2 center">
            <h2 style={{ fontSize: "1.15rem" }}>{team.name}</h2>
            {team.is_general && <span className="pill pill-brand">everyone</span>}
          </span>
          <span className="faint" style={{ fontSize: ".81rem" }}>
            {team.is_general
              ? "Everyone on every team you keep. Kept in step on its own."
              : team.description || "No description yet"}
          </span>
        </div>

        <div className="row gap-3 center">
          <span className="faces" aria-hidden>
            {faces.map((m) => (
              <Avatar key={m.id} name={m.user.display_name}
                      url={m.user.gitlab_avatar_url || undefined} />
            ))}
            {spare > 0 && <span className="avatar faces-more">+{spare}</span>}
            {faces.length === 0 && <span className="avatar faces-more">0</span>}
          </span>

          <span className="stack" style={{ lineHeight: 1 }}>
            <span className="strength" style={{ fontSize: "2rem" }}>
              {team.member_count}
            </span>
            <span className="faint" style={{ fontSize: ".7rem", letterSpacing: ".04em" }}>
              {plural(team.member_count, "person", "people")}
            </span>
          </span>

          <span className="chev" data-open={open}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                 strokeLinejoin="round" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </div>

        <div className="row between center wrap gap-3" style={{ width: "100%" }}>
          <span className="row gap-2 wrap center" style={{ fontSize: ".76rem" }}>
            <span className="pill pill-brand">{openTasks} open</span>
            {overdue > 0 && <span className="pill pill-overdue">{overdue} overdue</span>}
            {carrying > 0 && (
              <span className="pill pill-attention">
                {carrying} carrying over
              </span>
            )}
            {overdue === 0 && carrying === 0 && rows.length > 0 && (
              <span className="pill pill-done">nothing slipping</span>
            )}
          </span>
          {/* Nothing can be added to General directly — it is worked out from
              the other teams, so an Add button there would do nothing. */}
          {!team.is_general && <InvitePeople team={team} />}
        </div>
      </div>

      <div className="reveal" data-open={open}>
        <div>
          {members.length === 0 && (
            <Empty
              title={team.is_general ? "Nobody on any of your teams yet" : "Nobody on this team yet"}
              body={team.is_general
                ? "Build a team and put people on it — they show up here automatically."
                : "Add somebody signed up already, or share a link so they can join and sign up at once."}
            />
          )}

          {members.map((membership) => {
            const person = membership.user;
            const load = workload[person.id];
            return (
              <Link key={membership.id} href={`/team/${person.id}`} className="person-row">
                <Avatar name={person.display_name}
                        url={person.gitlab_avatar_url || undefined} />
                <span className="stack grow" style={{ minWidth: 0 }}>
                  <span className="row gap-2 center">
                    <span style={{ fontSize: ".89rem", fontWeight: 600 }}>
                      {person.display_name}
                    </span>
                    {(load?.todos_stale ?? 0) > 0 && (
                      <Thread days={(load?.todos_stale ?? 0) + 2} stale />
                    )}
                  </span>
                  <span className="faint" style={{ fontSize: ".74rem" }}>
                    {person.job_title || person.department}
                  </span>
                </span>

                {load ? (
                  <>
                    <span className="stat-mini">
                      <b>{load.open_tasks}</b>
                      <span>open</span>
                    </span>
                    <span className="stat-mini">
                      <b style={{ color: load.overdue_tasks ? "var(--overdue)" : undefined }}>
                        {load.overdue_tasks}
                      </b>
                      <span>overdue</span>
                    </span>
                    <span className="stat-mini">
                      <b>{load.todos_total - load.todos_pending}/{load.todos_total}</b>
                      <span>today</span>
                    </span>
                    <span className="stat-mini">
                      <b>{load.project_count}</b>
                      <span>projects</span>
                    </span>
                  </>
                ) : (
                  <span className="faint" style={{ fontSize: ".74rem" }}>no work yet</span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </article>
  );
}
