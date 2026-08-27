"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Thread, Tick } from "./ui";
import { relativeDue } from "@/lib/format";
import type { Task, Todo } from "@/lib/types";

/**
 * A day's list.
 *
 * Suggestions sit beneath the list rather than inside it: they are GitLab tasks
 * the person could pick up, not commitments they have made. Moving one up is a
 * deliberate act, which is the whole distinction between a task and a todo.
 *
 * Ticking means two different things here. A member ticking a line is saying
 * "I have finished this" — it goes amber and waits. Only their lead closes it,
 * and they do it in the morning meeting. Showing the difference matters: a
 * member who thinks they closed something, and a lead who never saw it, is the
 * exact failure the two stages exist to prevent.
 */
export function TodoList({
  todos, suggestions, date, canAdd, canTick, canClose, title, userId,
}: {
  todos: Todo[];
  suggestions: Task[];
  date: string;
  canAdd?: boolean;
  canTick?: boolean;
  canClose?: boolean;
  title: string;
  userId?: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  async function toggle(todo: Todo) {
    setBusy(todo.id);
    // An owner closes; everybody else claims. The backend enforces this either
    // way — sending the wrong one is folded down rather than refused — but
    // saying it plainly here keeps the button honest about what it does.
    const body = canClose
      ? { done: todo.status !== "closed" }
      : { claimed: todo.status === "open" };
    await fetch(`/api/proxy/api/daily/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    refresh();
  }

  async function remove(todo: Todo) {
    setBusy(todo.id);
    await fetch(`/api/proxy/api/daily/todos/${todo.id}`, { method: "DELETE" });
    setBusy(null);
    refresh();
  }

  async function add(title: string, taskId?: number) {
    if (!title.trim()) return;
    setAdding(true);
    await fetch("/api/proxy/api/daily/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(), date, user_id: userId ?? null, task_id: taskId ?? null,
      }),
    });
    setDraft("");
    setAdding(false);
    refresh();
  }

  const done = todos.filter((t) => t.is_done).length;
  const waiting = todos.filter((t) => t.is_claimed).length;

  return (
    <div className="stack gap-4">
      <div className="panel rise" style={{ overflow: "hidden" }}>
        <div className="panel-head">
          <h2 style={{ fontSize: "1.05rem" }}>{title}</h2>
          <span className="row gap-2 center">
            {waiting > 0 && (
              <span className="pill pill-attention">
                {waiting} waiting to be closed
              </span>
            )}
            <span className="mono faint" style={{ fontSize: ".78rem" }}>
              {done}/{todos.length}
            </span>
          </span>
        </div>

        <div className="stack">
          {todos.map((todo) => {
            const claimed = todo.status === "claimed";
            const closed = todo.status === "closed";
            const label = closed
              ? `Reopen ${todo.title}`
              : claimed
                ? `Undo marking ${todo.title} done`
                : `Mark ${todo.title} done`;

            return (
              <div key={todo.id} className="todo" data-done={closed}>
                {canTick && !(closed && !canClose) ? (
                  <button
                    className={`check ${claimed ? "check-claimed" : ""}`}
                    data-done={closed}
                    disabled={busy === todo.id}
                    onClick={() => toggle(todo)}
                    aria-label={label}
                  >
                    <Tick />
                  </button>
                ) : (
                  <span className={`check ${claimed ? "check-claimed" : ""}`}
                        data-done={closed} aria-hidden><Tick /></span>
                )}

                <Thread days={todo.carry_count} stale={todo.is_stale} />

                <span className="grow stack gap-1">
                  <span className="todo-title">{todo.title}</span>
                  <span className="row gap-2 center wrap" style={{ fontSize: ".72rem" }}>
                    {claimed && (
                      <span style={{ color: "var(--attention)" }}>
                        {todo.claimed_by_name
                          ? `marked done by ${todo.claimed_by_name} · waiting to be closed`
                          : "marked done · waiting to be closed"}
                      </span>
                    )}
                    {closed && todo.closed_by_name && (
                      <span className="faint">closed by {todo.closed_by_name}</span>
                    )}
                    {todo.task && (
                      <a href={todo.task.web_url} target="_blank" rel="noreferrer"
                         className="mono" style={{ color: "var(--brand)" }}>
                        #{todo.task.gitlab_iid} {todo.task.project_name}
                      </a>
                    )}
                    {todo.carry_count > 0 && (
                      <span className="faint">
                        carried {todo.carry_count} {todo.carry_count === 1 ? "day" : "days"}
                      </span>
                    )}
                    {todo.source === "meeting" && (
                      <span className="faint">from the standup</span>
                    )}
                  </span>
                </span>

                {canTick && !closed && (
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(todo)}
                          disabled={busy === todo.id} aria-label={`Remove ${todo.title}`}>
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {todos.length === 0 && (
            <p className="faint" style={{ padding: "22px 18px", fontSize: ".86rem" }}>
              Nothing here yet. Add something below, or pick up one of the suggestions.
            </p>
          )}
        </div>

        {canAdd && (
          <form
            onSubmit={(e) => { e.preventDefault(); add(draft); }}
            className="row gap-2"
            style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}
          >
            <input
              className="field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add something to today — it does not have to be a GitLab task"
            />
            <button className="btn btn-primary btn-sm" disabled={adding || !draft.trim()}>
              {adding && <span className="spin" />}
              Add
            </button>
          </form>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="panel rise" style={{ overflow: "hidden", animationDelay: "80ms" }}>
          <div className="panel-head">
            <div className="stack">
              <h2 style={{ fontSize: "1.02rem" }}>Could pick up</h2>
              <span className="faint" style={{ fontSize: ".77rem" }}>
                Open GitLab tasks, soonest due first
              </span>
            </div>
          </div>
          <div className="stack">
            {suggestions.map((task) => (
              <div key={task.id} className="todo">
                <span className="grow stack gap-1">
                  <span className="todo-title">{task.title}</span>
                  <span className="row gap-2 center wrap" style={{ fontSize: ".72rem" }}>
                    <span className="mono faint">{task.project_name}</span>
                    <span className="mono"
                          style={{ color: task.is_overdue ? "var(--overdue)" : "var(--ink-faint)" }}>
                      {relativeDue(task.due_date)}
                    </span>
                  </span>
                </span>
                {canAdd && (
                  <button className="btn btn-sm" onClick={() => add(task.title, task.id)}
                          disabled={adding}>
                    Add to today
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
