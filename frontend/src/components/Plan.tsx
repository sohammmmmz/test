"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar, Meter, Tick } from "./ui";
import { dueSoon, relativeDue, shortDate } from "@/lib/format";
import type { Milestone, Task, User } from "@/lib/types";

/**
 * The plan: milestones, and the tasks inside them.
 *
 * Everything written here goes to GitLab first and is only mirrored locally
 * once GitLab accepts it — so the board can never show a task that does not
 * exist as a real issue.
 */
export function Plan({ projectId, milestones, members, canEdit, currentUserId }: {
  projectId: number;
  milestones: Milestone[];
  members: User[];
  canEdit: boolean;
  currentUserId: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  async function send(url: string, method: string, body?: unknown) {
    setFailure(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFailure(data.detail ?? "GitLab turned that down. Nothing was changed.");
      return null;
    }
    return res.status === 204 ? {} : await res.json();
  }

  async function toggleTask(task: Task) {
    setBusy(`task-${task.id}`);
    const next = task.state === "closed" ? "opened" : "closed";
    if (await send(`/api/proxy/api/planning/tasks/${task.id}/`, "PATCH", { state: next })) {
      refresh();
    }
    setBusy(null);
  }

  async function reassign(task: Task, assigneeId: number | null) {
    setBusy(`task-${task.id}`);
    if (await send(`/api/proxy/api/planning/tasks/${task.id}/`, "PATCH",
                   { assignee_id: assigneeId })) {
      refresh();
    }
    setBusy(null);
  }

  const active = milestones.filter((m) => m.state === "active");
  const closed = milestones.filter((m) => m.state === "closed");

  return (
    <section className="stack gap-4">
      <div className="row between center wrap gap-3">
        <div className="stack gap-1">
          <h2>The plan</h2>
          <span className="faint" style={{ fontSize: ".8rem" }}>
            Milestones and tasks here are real GitLab milestones and issues.
          </span>
        </div>
        {canEdit && (
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            Add a milestone
          </button>
        )}
      </div>

      {failure && (
        <div className="panel" style={{ padding: "11px 15px", fontSize: ".84rem",
                                        background: "var(--overdue-wash)",
                                        borderColor: "var(--overdue)", color: "var(--overdue)" }}>
          {failure}
        </div>
      )}

      {adding && (
        <MilestoneForm
          projectId={projectId}
          onDone={() => { setAdding(false); refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {milestones.length === 0 && !adding && (
        <div className="panel" style={{ padding: 34, textAlign: "center" }}>
          <div className="stack gap-2 center">
            <strong style={{ fontSize: ".95rem" }}>No milestones yet</strong>
            <span className="faint" style={{ fontSize: ".85rem", maxWidth: "46ch" }}>
              A milestone gives the project a timeline to track against. Every one
              needs a due date — without one it is a label, not a plan.
            </span>
          </div>
        </div>
      )}

      <div className="stack gap-4">
        {[...active, ...closed].map((milestone, index) => (
          <MilestoneCard
            key={milestone.id}
            milestone={milestone}
            members={members}
            canEdit={canEdit}
            currentUserId={currentUserId}
            busy={busy}
            index={index}
            onToggleTask={toggleTask}
            onReassign={reassign}
            onChanged={refresh}
          />
        ))}
      </div>
    </section>
  );
}

function MilestoneCard({
  milestone, members, canEdit, currentUserId, busy, index,
  onToggleTask, onReassign, onChanged,
}: {
  milestone: Milestone;
  members: User[];
  canEdit: boolean;
  currentUserId: number;
  busy: string | null;
  index: number;
  onToggleTask: (task: Task) => void;
  onReassign: (task: Task, assigneeId: number | null) => void;
  onChanged: () => void;
}) {
  const [addingTask, setAddingTask] = useState(false);
  const done = milestone.state === "closed";

  return (
    <div className="panel rise" style={{ animationDelay: `${index * 60}ms`, overflow: "hidden",
                                         opacity: done ? .72 : 1 }}>
      <div className="panel-head" style={{ background: "var(--sunk)" }}>
        <div className="stack gap-1 grow">
          <div className="row gap-2 center wrap">
            <h3>{milestone.title}</h3>
            {milestone.is_overdue && <span className="pill pill-overdue">overdue</span>}
            {done && <span className="pill pill-done">closed</span>}
            {/* A group milestone is shared with the group's other projects, so
                it is shown but never edited from inside one of them. */}
            {milestone.is_inherited && (
              <span className="pill" title="Belongs to a parent group — edit it in GitLab">
                from the group
              </span>
            )}
          </div>
          <div className="row gap-3 center wrap" style={{ fontSize: ".76rem" }}>
            <span className="mono faint">
              {milestone.start_date ? `${shortDate(milestone.start_date)} → ` : ""}
              {shortDate(milestone.due_date)}
            </span>
            {dueSoon(milestone.due_date) && (
              <span className="mono"
                    style={{ color: milestone.is_overdue ? "var(--overdue)" : "var(--ink-faint)" }}>
                {dueSoon(milestone.due_date)}
              </span>
            )}
          </div>
        </div>
        <div className="stack gap-1" style={{ minWidth: 130 }}>
          <Meter percent={milestone.progress.percent}
                 tone={milestone.progress.percent === 100 ? "done"
                       : milestone.is_overdue ? "late" : undefined} />
          <span className="mono faint" style={{ fontSize: ".72rem", textAlign: "right" }}>
            {milestone.progress.done}/{milestone.progress.total} done
          </span>
        </div>
      </div>

      <div className="stack">
        {milestone.tasks.map((task) => {
          const isBusy = busy === `task-${task.id}`;
          const mayToggle = canEdit || task.assignee?.id === currentUserId;
          return (
            <div key={task.id} className="todo" data-done={task.state === "closed"}>
              <button
                className="check"
                data-done={task.state === "closed"}
                disabled={!mayToggle || isBusy}
                onClick={() => onToggleTask(task)}
                aria-label={task.state === "closed" ? `Reopen ${task.title}` : `Mark ${task.title} done`}
                title={mayToggle ? undefined : "Only the assignee or the project owner can change this"}
              >
                <Tick />
              </button>

              <span className="grow stack gap-1">
                <span className="todo-title">{task.title}</span>
                <span className="row gap-2 center wrap" style={{ fontSize: ".72rem" }}>
                  {task.gitlab_iid && (
                    <a href={task.web_url} target="_blank" rel="noreferrer"
                       className="mono" style={{ color: "var(--brand)" }}>
                      #{task.gitlab_iid}
                    </a>
                  )}
                  <span className="mono"
                        style={{ color: task.is_overdue ? "var(--overdue)" : "var(--ink-faint)" }}>
                    {relativeDue(task.due_date)}
                  </span>
                </span>
              </span>

              {canEdit ? (
                <select
                  className="field"
                  style={{ width: "auto", minWidth: 132, fontSize: ".78rem", padding: "5px 8px" }}
                  value={task.assignee?.id ?? ""}
                  disabled={isBusy}
                  onChange={(e) => onReassign(task, e.target.value ? Number(e.target.value) : null)}
                  aria-label={`Who is doing ${task.title}`}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.display_name}</option>
                  ))}
                </select>
              ) : task.assignee ? (
                <span className="row gap-2 center">
                  <Avatar name={task.assignee.display_name}
                          url={task.assignee.gitlab_avatar_url || undefined} />
                </span>
              ) : (
                <span className="pill">unassigned</span>
              )}
            </div>
          );
        })}

        {milestone.tasks.length === 0 && !addingTask && (
          <p className="faint" style={{ padding: "16px 18px", fontSize: ".84rem" }}>
            No tasks in this milestone yet.
          </p>
        )}

        {addingTask && (
          <TaskForm
            milestoneId={milestone.id}
            members={members}
            onDone={() => { setAddingTask(false); onChanged(); }}
            onCancel={() => setAddingTask(false)}
          />
        )}
      </div>

      {canEdit && !addingTask && (
        <div style={{ padding: "11px 18px", borderTop: "1px solid var(--line)" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setAddingTask(true)}>
            + Add a task
          </button>
        </div>
      )}
    </div>
  );
}

function MilestoneForm({ projectId, onDone, onCancel }: {
  projectId: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const res = await fetch("/api/proxy/api/planning/milestones/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: projectId, title, due_date: due, start_date: start || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFailure(data.detail ?? "GitLab would not create that milestone.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="panel stack gap-3 rise" style={{ padding: 18 }}>
      <div className="row gap-3 wrap">
        <label className="lbl grow" style={{ minWidth: 220 }}>
          Milestone
          <input className="field" value={title} required autoFocus
                 onChange={(e) => setTitle(e.target.value)}
                 placeholder="M1 — Payment rails" />
        </label>
        <label className="lbl">
          Starts
          <input className="field" type="date" value={start}
                 onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="lbl">
          Due
          <input className="field" type="date" value={due} required
                 onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      {failure && <p style={{ fontSize: ".82rem", color: "var(--overdue)" }}>{failure}</p>}
      <div className="row gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title || !due}>
          {busy && <span className="spin" />}
          {busy ? "Creating in GitLab" : "Create milestone"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      <p className="faint" style={{ fontSize: ".76rem" }}>
        A due date is required — the project counts as unplanned without one.
      </p>
    </form>
  );
}

function TaskForm({ milestoneId, members, onDone, onCancel }: {
  milestoneId: number;
  members: User[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<number | "">("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const res = await fetch("/api/proxy/api/planning/tasks/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        milestone: milestoneId, title,
        assignee_id: assignee || null, due_date: due || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setFailure(data.detail ?? "GitLab would not create that issue.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="stack gap-3"
          style={{ padding: "14px 18px", background: "var(--sunk)",
                   borderTop: "1px solid var(--line)" }}>
      <div className="row gap-3 wrap">
        <label className="lbl grow" style={{ minWidth: 200 }}>
          Task
          <input className="field" value={title} required autoFocus
                 onChange={(e) => setTitle(e.target.value)}
                 placeholder="Wire up the Stripe intent endpoint" />
        </label>
        <label className="lbl">
          Who
          <select className="field" value={assignee}
                  onChange={(e) => setAssignee(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </label>
        <label className="lbl">
          Due
          <input className="field" type="date" value={due}
                 onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      {failure && <p style={{ fontSize: ".82rem", color: "var(--overdue)" }}>{failure}</p>}
      <div className="row gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title}>
          {busy && <span className="spin" />}
          {busy ? "Creating the issue" : "Add task"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
