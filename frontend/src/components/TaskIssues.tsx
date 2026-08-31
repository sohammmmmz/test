"use client";

/**
 * Issues raised against one task.
 *
 * A task is work somebody planned. An issue is a problem found while doing it.
 * They are deliberately not the same list: if every defect became a task, a
 * milestone's progress would go backwards every time somebody found a bug,
 * which is exactly when you least want the plan to start lying.
 *
 * Where it gets filed depends on the task, and the panel says which. A task
 * that exists in GitLab gets a real GitLab issue, cross-referenced to the task
 * so it is findable from both ends. A task that only exists here — a project
 * with no repository, or a GitLab write that never landed — gets an issue held
 * here alone. Nothing else about it differs.
 *
 * Loaded on open rather than with the plan. A task with forty defects against
 * it should not make the board forty times heavier for everyone who never
 * clicks on it.
 */

import { useCallback, useEffect, useState } from "react";
import { useActivity } from "./Activity";
import { Confirm } from "./Confirm";
import { Modal } from "./Modal";
import { Avatar } from "./ui";
import type { Issue, Task, User } from "@/lib/types";

const SEVERITIES: { value: Issue["severity"]; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function TaskIssues({ task, members, onClose }: {
  task: Task;
  members: User[];
  onClose: () => void;
}) {
  const { run, refreshSoon } = useActivity();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Issue["severity"]>("medium");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [reopening, setReopening] = useState<Issue | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/api/planning/issues/?task=${task.id}`, {
        cache: "no-store",
      });
      if (!res.ok) { setFailed(true); return; }
      setIssues((await res.json()) as Issue[]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [task.id]);

  useEffect(() => { load(); }, [load]);

  function log(event: React.FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) return;

    const assignee = members.find((m) => String(m.id) === assigneeId) ?? null;
    // A stand-in row, so the list grows on the same frame as the button. The
    // negative id cannot collide with a real one and is replaced on reload.
    setIssues((all) => [{
      id: -Date.now(),
      task: task.id,
      task_title: task.title,
      task_gitlab_iid: task.gitlab_iid,
      title: text,
      description,
      severity,
      severity_display: SEVERITIES.find((s) => s.value === severity)?.label ?? severity,
      state: "opened",
      reported_by: null,
      assignee,
      gitlab_iid: null,
      web_url: "",
      is_linked: false,
      is_in_gitlab: false,
      is_open: true,
      project_id: task.project_id,
      project_name: task.project_name,
      milestone_id: task.milestone,
      milestone_title: task.milestone_title,
      closed_at: null,
      created_at: new Date().toISOString(),
    }, ...(all ?? [])]);

    setTitle("");
    setDescription("");
    setSeverity("medium");
    setAssigneeId("");

    run({
      key: `issue:new:${task.id}:${text}`,
      pending: "Logging the issue",
      done: task.gitlab_iid ? `Logged “${text}” in GitLab` : `Logged “${text}”`,
      failed: `Could not log “${text}” against “${task.title}”`,
      method: "POST",
      path: "/api/planning/issues/",
      body: {
        task: task.id,
        title: text,
        description,
        severity,
        assignee_id: assigneeId ? Number(assigneeId) : null,
      },
      targetUrl: `/projects/${task.project_id}`,
      quiet: true,
      // The plan shows a count per task, so the board behind this dialog is now
      // wrong too — but only once the server has actually taken it.
      onSuccess: () => { load(); refreshSoon(); },
    });
  }

  function setState(issue: Issue, closed: boolean) {
    setIssues((all) => (all ?? []).map((i) => (
      i.id === issue.id
        ? { ...i, state: closed ? "closed" : "opened", is_open: !closed }
        : i
    )));
    run({
      key: `issue:${issue.id}:state`,
      pending: closed ? "Resolving" : "Reopening",
      done: closed ? `Resolved “${issue.title}”` : `Reopened “${issue.title}”`,
      failed: closed
        ? `Could not resolve “${issue.title}”`
        : `Could not reopen “${issue.title}”`,
      method: "PATCH",
      path: `/api/planning/issues/${issue.id}/`,
      body: { state: closed ? "closed" : "opened" },
      quiet: true,
      onSuccess: () => { load(); refreshSoon(); },
    });
  }

  const open = (issues ?? []).filter((i) => i.state === "opened");
  const resolved = (issues ?? []).filter((i) => i.state === "closed");

  return (
    <Modal label={`Issues on ${task.title}`} onClose={onClose}>
      {reopening && (
        <Confirm
          title="Reopen this issue?"
          body={`“${reopening.title}” is marked resolved.${
            reopening.is_in_gitlab ? " Reopening it here reopens it in GitLab too." : ""
          }`}
          confirmLabel="Reopen it"
          tone="attention"
          onCancel={() => setReopening(null)}
          onConfirm={() => { setState(reopening, false); setReopening(null); }}
        />
      )}

      <div
        className="panel stack gap-4 rise"
        style={{ padding: 24, width: "100%", maxWidth: 620, maxHeight: "90vh",
                 overflowY: "auto", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="stack gap-1">
          <span className="eyebrow">Issues</span>
          <h2 style={{ fontSize: "1.1rem" }}>{task.title}</h2>
          <p className="faint" style={{ fontSize: ".8rem", lineHeight: 1.55 }}>
            {task.gitlab_iid
              ? <>Anything logged here is filed in GitLab as a real issue and
                  cross-referenced to <span className="mono">#{task.gitlab_iid}</span>,
                  so it is findable from both sides.</>
              : <>This task does not exist in GitLab, so issues against it are
                  kept here. Nothing is lost — they behave the same everywhere
                  else in the app.</>}
          </p>
        </div>

        <form onSubmit={log} className="stack gap-3"
              style={{ padding: 14, borderRadius: "var(--radius)",
                       background: "var(--brand-wash)" }}>
          <label className="lbl">
            What is wrong
            <input className="field" value={title} required autoFocus
                   onChange={(e) => setTitle(e.target.value)}
                   placeholder="Login returns a 500 on the second attempt" />
          </label>
          <label className="lbl">
            More detail
            <textarea className="field" rows={3} value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="How to reproduce it, what you expected instead." />
          </label>
          <div className="row gap-2 wrap">
            <label className="lbl grow" style={{ minWidth: 130 }}>
              Severity
              <select className="field" value={severity}
                      onChange={(e) => setSeverity(e.target.value as Issue["severity"])}>
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="lbl grow" style={{ minWidth: 150 }}>
              Who should look at it
              <select className="field" value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Nobody yet</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-primary btn-sm" disabled={!title.trim()}
                  style={{ alignSelf: "flex-start" }}>
            Log this issue
          </button>
        </form>

        {issues === null && !failed && (
          <p className="faint" style={{ fontSize: ".82rem" }}>Reading the issues…</p>
        )}
        {failed && (
          <p style={{ fontSize: ".82rem", color: "var(--overdue)" }}>
            The issues on this task could not be read. The form above still works.
          </p>
        )}

        {open.length > 0 && (
          <Section title={`${open.length} open`}>
            {open.map((issue) => (
              <Row key={issue.id} issue={issue} onResolve={() => setState(issue, true)} />
            ))}
          </Section>
        )}

        {resolved.length > 0 && (
          <Section title={`${resolved.length} resolved`}>
            {resolved.map((issue) => (
              <Row key={issue.id} issue={issue} onReopen={() => setReopening(issue)} />
            ))}
          </Section>
        )}

        {issues !== null && issues.length === 0 && (
          <p className="faint" style={{ fontSize: ".82rem" }}>
            Nothing raised against this task yet.
          </p>
        )}

        <button className="btn btn-ghost btn-sm" onClick={onClose}
                style={{ alignSelf: "flex-end" }}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stack gap-2">
      <span className="eyebrow">{title}</span>
      <div className="stack gap-2">{children}</div>
    </div>
  );
}

function Row({ issue, onResolve, onReopen }: {
  issue: Issue;
  onResolve?: () => void;
  onReopen?: () => void;
}) {
  return (
    <div className="issue-row" data-severity={issue.severity}
         data-resolved={issue.state === "closed"}>
      <span className="stack gap-1 grow" style={{ minWidth: 0 }}>
        <span className="row gap-2 center wrap">
          <span style={{ fontSize: ".86rem", fontWeight: 500 }}>{issue.title}</span>
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
          {issue.reported_by && (
            <span className="faint">raised by {issue.reported_by.display_name}</span>
          )}
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
              #{issue.gitlab_iid} in GitLab
            </a>
          ) : (
            <span className="faint">kept here only</span>
          )}
        </span>
      </span>
      {onResolve && (
        <button className="btn btn-sm" onClick={onResolve}>Resolve</button>
      )}
      {onReopen && (
        <button className="btn btn-ghost btn-sm" onClick={onReopen}>Reopen</button>
      )}
    </div>
  );
}
