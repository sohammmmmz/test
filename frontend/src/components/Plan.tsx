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
  // Which milestone is open. One at a time: comparing two task lists side by
  // side is not something anybody does, and it is what makes the grid tall.
  const [openId, setOpenId] = useState<number | null>(null);

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
  const ordered = [...active, ...closed];
  const open = ordered.find((m) => m.id === openId) ?? null;

  const totalTasks = milestones.reduce((n, m) => n + m.progress.total, 0);
  const doneTasks = milestones.reduce((n, m) => n + m.progress.done, 0);
  const late = active.filter((m) => m.is_overdue).length;

  return (
    <section className="stack gap-4">
      <div className="row between center wrap gap-3">
        <div className="stack gap-1">
          <h2>The plan</h2>
          <span className="faint" style={{ fontSize: ".8rem" }}>
            {milestones.length} {milestones.length === 1 ? "milestone" : "milestones"} ·{" "}
            {doneTasks}/{totalTasks} {totalTasks === 1 ? "task" : "tasks"} done
            {late > 0 && (
              <span style={{ color: "var(--overdue)" }}> · {late} past its date</span>
            )}
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

      {ordered.length > 0 && (
        <div className="mgrid">
          {ordered.map((milestone, index) => (
            <MilestoneTile
              key={milestone.id}
              milestone={milestone}
              index={index}
              isOpen={milestone.id === openId}
              onOpen={() => setOpenId(milestone.id === openId ? null : milestone.id)}
            />
          ))}
        </div>
      )}

      {open && (
        <MilestoneDetail
          key={open.id}
          milestone={open}
          members={members}
          canEdit={canEdit}
          currentUserId={currentUserId}
          busy={busy}
          onToggleTask={toggleTask}
          onReassign={reassign}
          onChanged={refresh}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

/**
 * One milestone as a square.
 *
 * The count sits inside its own progress ring, so "eight tasks, most of them
 * done" is a single glance rather than a number and then a bar to interpret.
 */
function MilestoneTile({ milestone, index, isOpen, onOpen }: {
  milestone: Milestone;
  index: number;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const { total, done, percent } = milestone.progress;
  const openCount = total - done;
  const closed = milestone.state === "closed";
  const late = milestone.is_overdue && !closed;

  return (
    <button
      className="mtile rise"
      style={{ animationDelay: `${index * 45}ms` }}
      data-open={isOpen}
      data-late={late}
      data-state={milestone.state}
      onClick={onOpen}
      aria-expanded={isOpen}
      title={milestone.title}
    >
      <span className="stack gap-1">
        <span className="mtile-title">{milestone.title}</span>
        <span className="mono" style={{ fontSize: ".67rem",
                     color: late ? "var(--overdue)" : "var(--ink-faint)" }}>
          {milestone.due_date ? shortDate(milestone.due_date) : "no date"}
          {dueSoon(milestone.due_date) && ` · ${dueSoon(milestone.due_date)}`}
        </span>
      </span>

      <Ring total={total} done={done} percent={percent}
            tone={closed || percent === 100 ? "done" : late ? "late" : undefined} />

      <span className="mtile-foot">
        <span>{total === 0 ? "empty" : `${openCount} open`}</span>
        {milestone.is_inherited && <span title="Belongs to a parent group">group</span>}
        <span>{done} done</span>
      </span>

    </button>
  );
}

function Ring({ total, done, percent, tone }: {
  total: number;
  done: number;
  percent: number;
  tone?: "done" | "late";
}) {
  const R = 30;
  const circumference = 2 * Math.PI * R;
  const filled = (Math.min(percent, 100) / 100) * circumference;

  return (
    <span className="ring" data-tone={tone} role="img"
          aria-label={`${done} of ${total} tasks done`}>
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle className="ring-track" cx="38" cy="38" r={R} strokeWidth="6" />
        {/* Omitted entirely at zero: a round line cap paints a dot even for a
            zero-length arc, which reads as a milestone that has started. */}
        {filled > 0 && (
          <circle className="ring-fill" cx="38" cy="38" r={R} strokeWidth="6"
                  strokeDasharray={`${filled} ${circumference - filled}`} />
        )}
      </svg>
      <span className="ring-label">
        <b>{total}</b>
        <span>{total === 1 ? "TASK" : "TASKS"}</span>
      </span>
    </span>
  );
}

/** The open milestone: its tasks, who has them, and what is left. */
function MilestoneDetail({
  milestone, members, canEdit, currentUserId, busy,
  onToggleTask, onReassign, onChanged, onClose,
}: {
  milestone: Milestone;
  members: User[];
  canEdit: boolean;
  currentUserId: number;
  busy: string | null;
  onToggleTask: (task: Task) => void;
  onReassign: (task: Task, assigneeId: number | null) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [addingTask, setAddingTask] = useState(false);
  const done = milestone.state === "closed";
  const { total, done: closedCount } = milestone.progress;
  const openCount = total - closedCount;

  // Open first: what is left is the reason anybody opened this.
  const tasks = [...milestone.tasks].sort((a, b) => {
    if ((a.state === "closed") !== (b.state === "closed")) return a.state === "closed" ? 1 : -1;
    return 0;
  });

  // Who is carrying this milestone, and how much of it is nobody's.
  const unassigned = tasks.filter((t) => t.state !== "closed" && !t.assignee).length;

  return (
    <div className="panel rise" style={{ overflow: "hidden" }}>
      <div className="panel-head" style={{ background: "var(--sunk)" }}>
        <div className="stack gap-1 grow">
          <div className="row gap-2 center wrap">
            <h3>{milestone.title}</h3>
            {milestone.is_overdue && !done && <span className="pill pill-overdue">overdue</span>}
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
            <span className="mono faint">
              {openCount} open · {closedCount} done
            </span>
            {unassigned > 0 && (
              <span className="mono" style={{ color: "var(--attention)" }}>
                {unassigned} unassigned
              </span>
            )}
          </div>
        </div>
        <div className="row gap-3 center">
          <div className="stack gap-1" style={{ minWidth: 120 }}>
            <Meter percent={milestone.progress.percent}
                   tone={milestone.progress.percent === 100 ? "done"
                         : milestone.is_overdue ? "late" : undefined} />
            <span className="mono faint" style={{ fontSize: ".72rem", textAlign: "right" }}>
              {closedCount}/{total} done
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      <div className="stack">
        {tasks.map((task) => {
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
                  {/* Say which it is rather than calling an issue a task. */}
                  {task.work_item_type === "issue" && (
                    <span className="faint" title="A GitLab issue, not a task work item">
                      issue
                    </span>
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

        {tasks.length === 0 && !addingTask && (
          <p className="faint" style={{ padding: "16px 18px", fontSize: ".84rem" }}>
            Nothing filed under this milestone yet. Work planned in GitLab shows up
            here after a sync — as long as it carries this milestone.
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
