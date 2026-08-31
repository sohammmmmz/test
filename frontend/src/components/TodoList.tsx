"use client";

import { useEffect, useMemo, useState } from "react";
import { useActivity } from "./Activity";
import { Confirm } from "./Confirm";
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
  const { run, inFlight } = useActivity();
  const [draft, setDraft] = useState("");

  /**
   * The optimistic layer.
   *
   * Ticking a line changes it here first and sends the write afterwards, so the
   * tick mark moves on the same frame as the click rather than two round trips
   * later. These overrides are thrown away wholesale whenever a fresh `todos`
   * prop arrives — which is exactly when the server has re-rendered the route
   * and its answer supersedes the guess, whether the write succeeded or not.
   */
  const [patched, setPatched] = useState<Record<number, Partial<Todo>>>({});
  const [dropped, setDropped] = useState<number[]>([]);
  const [provisional, setProvisional] = useState<Todo[]>([]);
  const [undoing, setUndoing] = useState<Todo | null>(null);

  useEffect(() => {
    setPatched({});
    setDropped([]);
    setProvisional([]);
  }, [todos]);

  const rows = useMemo(() => {
    const merged = todos
      .filter((t) => !dropped.includes(t.id))
      .map((t) => (patched[t.id] ? { ...t, ...patched[t.id] } : t));
    return [...merged, ...provisional];
  }, [todos, patched, dropped, provisional]);

  /**
   * Ticking is immediate; unticking asks.
   *
   * The two are the same button, and on a list of finished lines a misplaced
   * click reopens work that has already been reported as done in the morning
   * meeting. Putting a dialog in front of the reversal — and only the reversal
   * — costs nothing on the action people take twenty times a day and catches
   * the one they take by accident.
   */
  function requestToggle(todo: Todo) {
    const reversing = canClose ? todo.status === "closed" : todo.status === "claimed";
    if (reversing) setUndoing(todo);
    else toggle(todo);
  }

  function toggle(todo: Todo) {
    // An owner closes; everybody else claims. The backend enforces this either
    // way — sending the wrong one is folded down rather than refused — but
    // saying it plainly here keeps the button honest about what it does.
    const closing = canClose && todo.status !== "closed";
    const claiming = !canClose && todo.status === "open";
    const body = canClose ? { done: closing } : { claimed: claiming };

    const next: Partial<Todo> = canClose
      ? closing
        ? { status: "closed", is_done: true, is_claimed: false }
        : { status: "open", is_done: false, is_claimed: false }
      : claiming
        ? { status: "claimed", is_claimed: true, is_done: false }
        : { status: "open", is_claimed: false, is_done: false };

    setPatched((all) => ({ ...all, [todo.id]: { ...all[todo.id], ...next } }));

    const verb = canClose
      ? closing ? "Closed" : "Reopened"
      : claiming ? "Marked done" : "Unmarked";
    run({
      key: `todo:${todo.id}:tick`,
      pending: `${verb} “${todo.title}”`,
      done: `${verb} “${todo.title}”`,
      failed: `Could not update “${todo.title}”`,
      method: "PATCH",
      path: `/api/daily/todos/${todo.id}`,
      body,
    });
  }

  function remove(todo: Todo) {
    setDropped((all) => [...all, todo.id]);
    run({
      key: `todo:${todo.id}:remove`,
      pending: `Removing “${todo.title}”`,
      done: `Removed “${todo.title}”`,
      failed: `Could not remove “${todo.title}”`,
      method: "DELETE",
      path: `/api/daily/todos/${todo.id}`,
    });
  }

  function add(title: string, taskId?: number) {
    const text = title.trim();
    if (!text) return;

    // A stand-in row so the list grows on the same frame as the Enter key. The
    // negative id cannot collide with a real one, and the whole row is replaced
    // by the server's version on the next refresh.
    setProvisional((all) => [...all, {
      id: -Date.now(),
      title: text,
      status: "open",
      is_done: false,
      is_claimed: false,
      is_stale: false,
      carry_count: 0,
      source: "manual",
      task: null,
      claimed_by_name: null,
      closed_by_name: null,
    } as unknown as Todo]);
    setDraft("");

    run({
      key: `todo:add:${text}:${taskId ?? ""}`,
      pending: `Adding “${text}”`,
      done: `Added “${text}”`,
      failed: `Could not add “${text}”`,
      method: "POST",
      path: "/api/daily/todos",
      body: { title: text, date, user_id: userId ?? null, task_id: taskId ?? null },
    });
  }

  const done = rows.filter((t) => t.is_done).length;
  const waiting = rows.filter((t) => t.is_claimed).length;

  return (
    <div className="stack gap-4">
      {undoing && (
        <Confirm
          title={canClose ? "Reopen this?" : "Mark this as not done?"}
          body={
            canClose
              ? `“${undoing.title}” has been closed. Reopening puts it back on the list as unfinished work.`
              : `“${undoing.title}” is marked done and waiting to be closed in the morning meeting. This takes that back.`
          }
          confirmLabel={canClose ? "Reopen it" : "Mark as not done"}
          tone="attention"
          onCancel={() => setUndoing(null)}
          onConfirm={() => { toggle(undoing); setUndoing(null); }}
        />
      )}

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
              {done}/{rows.length}
            </span>
          </span>
        </div>

        <div className="stack">
          {rows.map((todo) => {
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
                    onClick={() => requestToggle(todo)}
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
                          aria-label={`Remove ${todo.title}`}>
                    ×
                  </button>
                )}
              </div>
            );
          })}

          {rows.length === 0 && (
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
            <button className="btn btn-primary btn-sm" disabled={!draft.trim()}>
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
                  <button className="btn btn-sm" onClick={() => add(task.title, task.id)}>
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
