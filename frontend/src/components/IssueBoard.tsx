"use client";

/**
 * Every issue, worked rather than recorded.
 *
 * The dialog on a task is where a problem gets written down, at the moment it
 * is found. This is the other half: the pile, sorted, filtered, and cleared.
 * They want opposite shapes, which is why they are two screens and not one.
 *
 * Grouped by project, with **Not on a project** last. That group is the reason
 * this page exists — an issue raised against a line on somebody's day belongs
 * to no milestone and no project, so before this there was nowhere it could be
 * seen at all.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useActivity } from "./Activity";
import { Confirm } from "./Confirm";
import { Avatar, Empty } from "./ui";
import { shortDate } from "@/lib/format";
import type { Issue, User } from "@/lib/types";

type StateFilter = "open" | "closed" | "all";
const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
const UNFILED = "Not on a project";

export function IssueBoard({ initial, people, canReassign }: {
  initial: Issue[];
  people: User[];
  canReassign: boolean;
}) {
  const { run, refreshSoon } = useActivity();
  const [issues, setIssues] = useState(initial);
  const [state, setState] = useState<StateFilter>("open");
  const [severity, setSeverity] = useState<string>("");
  const [project, setProject] = useState<string>("");
  const [reopening, setReopening] = useState<Issue | null>(null);

  // The server's answer supersedes anything optimistic the moment it arrives.
  useEffect(() => setIssues(initial), [initial]);

  const projects = useMemo(() => {
    const names = new Set<string>();
    for (const issue of issues) names.add(issue.project_name ?? UNFILED);
    return [...names].sort((a, b) =>
      a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b));
  }, [issues]);

  const shown = useMemo(() => issues.filter((issue) => {
    if (state === "open" && issue.state !== "opened") return false;
    if (state === "closed" && issue.state !== "closed") return false;
    if (severity && issue.severity !== severity) return false;
    if (project && (issue.project_name ?? UNFILED) !== project) return false;
    return true;
  }), [issues, state, severity, project]);

  const grouped = useMemo(() => {
    const byProject = new Map<string, Issue[]>();
    for (const issue of shown) {
      const key = issue.project_name ?? UNFILED;
      byProject.set(key, [...(byProject.get(key) ?? []), issue]);
    }
    for (const rows of byProject.values()) {
      // Worst first inside each project — the order somebody would work them.
      rows.sort((a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
        || b.created_at.localeCompare(a.created_at));
    }
    return [...byProject.entries()].sort(([a], [b]) =>
      a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b));
  }, [shown]);

  const open = issues.filter((i) => i.state === "opened");
  const critical = open.filter((i) => i.severity === "critical").length;

  function patch(issue: Issue, change: Partial<Issue>, body: unknown,
                 done: string, failed: string, key: string) {
    setIssues((all) => all.map((i) => (i.id === issue.id ? { ...i, ...change } : i)));
    run({
      key,
      pending: done,
      done,
      failed,
      method: "PATCH",
      path: `/api/planning/issues/${issue.id}/`,
      body,
      targetUrl: "/issues",
      onSuccess: () => refreshSoon(),
    });
  }

  const setResolved = (issue: Issue, closed: boolean) =>
    patch(issue,
      { state: closed ? "closed" : "opened", is_open: !closed },
      { state: closed ? "closed" : "opened" },
      closed ? `Resolved “${issue.title}”` : `Reopened “${issue.title}”`,
      closed ? `Could not resolve “${issue.title}”` : `Could not reopen “${issue.title}”`,
      `issue:${issue.id}:state`);

  const reassign = (issue: Issue, personId: number | null) => {
    const person = people.find((p) => p.id === personId) ?? null;
    patch(issue, { assignee: person }, { assignee_id: personId },
      person ? `Handed to ${person.display_name}` : "Unassigned",
      `Could not reassign “${issue.title}”`,
      `issue:${issue.id}:assignee`);
  };

  return (
    <>
      {reopening && (
        <Confirm
          title="Reopen this issue?"
          body={`“${reopening.title}” is marked resolved.${
            reopening.is_in_gitlab ? " Reopening it here reopens it in GitLab too." : ""
          }`}
          confirmLabel="Reopen it"
          tone="attention"
          onCancel={() => setReopening(null)}
          onConfirm={() => { setResolved(reopening, false); setReopening(null); }}
        />
      )}

      <header className="page-head dawn">
        <div className="stack gap-2">
          <span className="eyebrow">Issues</span>
          <h1>What is wrong</h1>
          <p className="faint" style={{ fontSize: ".86rem", maxWidth: "62ch" }}>
            {open.length === 0
              ? "Nothing open. Issues are raised from the flag on any task or any line on a day."
              : <>{open.length} open{critical > 0 && <>, <span style={{ color: "var(--overdue)" }}>
                  {critical} critical</span></>}. Raised from the flag on any task,
                  or on any line on somebody&rsquo;s day.</>}
          </p>
        </div>
      </header>

      <div className="page-body stack gap-4">
        <div className="row gap-3 wrap center">
          <Group label="Show">
            {(["open", "closed", "all"] as StateFilter[]).map((value) => (
              <Chip key={value} active={state === value} onClick={() => setState(value)}>
                {value === "open" ? "Open" : value === "closed" ? "Resolved" : "All"}
              </Chip>
            ))}
          </Group>

          <Group label="Severity">
            <Chip active={!severity} onClick={() => setSeverity("")}>Any</Chip>
            {SEVERITY_ORDER.map((value) => (
              <Chip key={value} active={severity === value}
                    onClick={() => setSeverity(severity === value ? "" : value)}>
                {value[0].toUpperCase() + value.slice(1)}
              </Chip>
            ))}
          </Group>

          {projects.length > 1 && (
            <Group label="Project">
              <Chip active={!project} onClick={() => setProject("")}>All</Chip>
              {projects.map((name) => (
                <Chip key={name} active={project === name}
                      onClick={() => setProject(project === name ? "" : name)}>
                  {name}
                </Chip>
              ))}
            </Group>
          )}
        </div>

        {grouped.length === 0 && (
          <Empty
            title={issues.length === 0 ? "No issues raised" : "Nothing matches that"}
            body={issues.length === 0
              ? "Open any task in a plan, or any line on a day, and use the flag to log a problem against it."
              : "Try widening the filters above."}
          />
        )}

        {grouped.map(([name, rows]) => (
          <section key={name} className="panel rise" style={{ overflow: "hidden" }}>
            <div className="panel-head">
              <div className="stack">
                <h2 style={{ fontSize: "1.02rem" }}>{name}</h2>
                <span className="faint" style={{ fontSize: ".76rem" }}>
                  {name === UNFILED
                    ? "Raised against a line on somebody's day, so it belongs to no plan."
                    : `${rows.length} ${rows.length === 1 ? "issue" : "issues"} shown`}
                </span>
              </div>
              {rows[0]?.project_id && (
                <Link href={`/projects/${rows[0].project_id}`} className="btn btn-ghost btn-sm">
                  Open the project
                </Link>
              )}
            </div>

            <div className="stack gap-2" style={{ padding: 14 }}>
              {rows.map((issue) => (
                <div key={issue.id} className="issue-row" data-severity={issue.severity}
                     data-resolved={issue.state === "closed"}>
                  <span className="stack gap-1 grow" style={{ minWidth: 0 }}>
                    <span className="row gap-2 center wrap">
                      <span style={{ fontSize: ".88rem", fontWeight: 500 }}>
                        {issue.title}
                      </span>
                      <span className="pill" data-severity={issue.severity}>
                        {issue.severity_display}
                      </span>
                    </span>
                    {issue.description && (
                      <span className="soft" style={{ fontSize: ".78rem", lineHeight: 1.5 }}>
                        {issue.description}
                      </span>
                    )}
                    <span className="row gap-2 center wrap" style={{ fontSize: ".71rem" }}>
                      <span className="faint">
                        on “{issue.task_title ?? issue.raised_against}”
                      </span>
                      {issue.milestone_title && (
                        <span className="faint">· {issue.milestone_title}</span>
                      )}
                      {issue.reported_by && (
                        <span className="faint">· raised by {issue.reported_by.display_name}</span>
                      )}
                      <span className="faint">· {shortDate(issue.created_at)}</span>
                      {issue.web_url ? (
                        <a href={issue.web_url} target="_blank" rel="noreferrer"
                           className="mono" style={{ color: "var(--brand)" }}>
                          #{issue.gitlab_iid} in GitLab
                        </a>
                      ) : (
                        <span className="faint">· kept here only</span>
                      )}
                    </span>
                  </span>

                  {canReassign && people.length > 0 ? (
                    <select
                      className="field"
                      style={{ width: "auto", minWidth: 130, fontSize: ".76rem",
                               padding: "4px 7px" }}
                      value={issue.assignee?.id ?? ""}
                      onChange={(e) =>
                        reassign(issue, e.target.value ? Number(e.target.value) : null)}
                      aria-label={`Who is looking at ${issue.title}`}
                    >
                      <option value="">Nobody</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>{p.display_name}</option>
                      ))}
                    </select>
                  ) : issue.assignee ? (
                    <span className="row gap-1 center">
                      <Avatar name={issue.assignee.display_name}
                              url={issue.assignee.gitlab_avatar_url || undefined} />
                    </span>
                  ) : null}

                  {issue.state === "opened" ? (
                    <button className="btn btn-sm" onClick={() => setResolved(issue, true)}>
                      Resolve
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => setReopening(issue)}>
                      Reopen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row gap-2 center">
      <span className="eyebrow" style={{ fontSize: ".66rem" }}>{label}</span>
      <div className="row gap-1 wrap">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className="filter-chip" data-active={active} onClick={onClick}>
      {children}
    </button>
  );
}
