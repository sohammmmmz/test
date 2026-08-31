"use client";

/**
 * Every issue raised across one project.
 *
 * The per-task dialog is where an issue is logged; this is where the project as
 * a whole is read. Both exist because they answer different questions — "what
 * is wrong with this piece of work" and "what is wrong with this project" — and
 * the second one is the one a member on the project actually opens.
 *
 * Fetched from the client rather than rendered on the server. The project page
 * is already several requests deep, and this is a panel most visits never
 * expand; making everyone wait for it to open a project would be the same
 * mistake the reconcile was.
 */

import { useCallback, useEffect, useState } from "react";
import { useActivity } from "./Activity";
import { Avatar } from "./ui";
import { shortDate } from "@/lib/format";
import type { Issue } from "@/lib/types";

type Filter = "open" | "closed" | "all";

export function ProjectIssues({ projectId }: { projectId: number }) {
  const { run, refreshSoon } = useActivity();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/api/planning/issues/?project=${projectId}`,
                              { cache: "no-store" });
      if (!res.ok) { setFailed(true); return; }
      setIssues((await res.json()) as Issue[]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function resolve(issue: Issue) {
    setIssues((all) => (all ?? []).map((i) =>
      i.id === issue.id ? { ...i, state: "closed", is_open: false } : i));
    run({
      key: `issue:${issue.id}:state`,
      pending: "Resolving",
      done: `Resolved “${issue.title}”`,
      failed: `Could not resolve “${issue.title}”`,
      method: "PATCH",
      path: `/api/planning/issues/${issue.id}/`,
      body: { state: "closed" },
      quiet: true,
      onSuccess: () => { load(); refreshSoon(); },
    });
  }

  const all = issues ?? [];
  const open = all.filter((i) => i.state === "opened");
  const shown = filter === "all" ? all
    : filter === "open" ? open
      : all.filter((i) => i.state === "closed");

  // Nothing has ever been raised: say so once, quietly, and take up no room.
  if (issues !== null && all.length === 0 && !failed) {
    return (
      <section className="panel" style={{ padding: "16px 18px" }}>
        <div className="stack gap-1">
          <h2 style={{ fontSize: "1.02rem" }}>Issues</h2>
          <span className="faint" style={{ fontSize: ".8rem" }}>
            Nothing raised on this project. Use the flag on any task to log one.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel rise" style={{ overflow: "hidden" }}>
      <div className="panel-head">
        <div className="stack">
          <h2 style={{ fontSize: "1.02rem" }}>Issues</h2>
          <span className="faint" style={{ fontSize: ".77rem" }}>
            {open.length} open across this project
          </span>
        </div>
        <div className="row gap-1">
          {(["open", "closed", "all"] as Filter[]).map((value) => (
            <button key={value} className="btn btn-ghost btn-sm"
                    data-active={filter === value}
                    style={filter === value
                      ? { background: "var(--brand-wash)", color: "var(--ink)" }
                      : undefined}
                    onClick={() => setFilter(value)}>
              {value === "open" ? "Open" : value === "closed" ? "Resolved" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="stack gap-2" style={{ padding: 14 }}>
        {issues === null && !failed && (
          <span className="faint" style={{ fontSize: ".82rem" }}>Reading the issues…</span>
        )}
        {failed && (
          <span style={{ fontSize: ".82rem", color: "var(--overdue)" }}>
            The issues on this project could not be read.
          </span>
        )}

        {shown.map((issue) => (
          <div key={issue.id} className="issue-row" data-severity={issue.severity}
               data-resolved={issue.state === "closed"}>
            <span className="stack gap-1 grow" style={{ minWidth: 0 }}>
              <span className="row gap-2 center wrap">
                <span style={{ fontSize: ".86rem", fontWeight: 500 }}>{issue.title}</span>
                <span className="pill" data-severity={issue.severity}>
                  {issue.severity_display}
                </span>
              </span>
              <span className="row gap-2 center wrap" style={{ fontSize: ".71rem" }}>
                <span className="faint">on “{issue.task_title}”</span>
                <span className="faint">· {issue.milestone_title}</span>
                {issue.assignee && (
                  <span className="row gap-1 center">
                    <Avatar name={issue.assignee.display_name}
                            url={issue.assignee.gitlab_avatar_url || undefined} />
                    <span className="faint">{issue.assignee.display_name}</span>
                  </span>
                )}
                {issue.web_url ? (
                  <a href={issue.web_url} target="_blank" rel="noreferrer"
                     className="mono" style={{ color: "var(--brand)" }}>
                    #{issue.gitlab_iid}
                  </a>
                ) : (
                  <span className="faint">kept here only</span>
                )}
                <span className="faint">· {shortDate(issue.created_at)}</span>
              </span>
            </span>
            {issue.state === "opened" && (
              <button className="btn btn-sm" onClick={() => resolve(issue)}>Resolve</button>
            )}
          </div>
        ))}

        {issues !== null && shown.length === 0 && (
          <span className="faint" style={{ fontSize: ".82rem" }}>
            {filter === "open" ? "Nothing open." : "Nothing resolved yet."}
          </span>
        )}
      </div>
    </section>
  );
}
