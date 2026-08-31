"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActivity } from "./Activity";
import { Confirm } from "./Confirm";
import { Avatar, Thread, Tick } from "./ui";
import { longDate, plural, relativeDue, shortDate, weekday } from "@/lib/format";
import type { MeetingBoard, MeetingRow, Team, Todo } from "@/lib/types";

/**
 * The morning meeting.
 *
 * It opens on the board — the whole team side by side, so the owner walks in
 * already knowing where the trouble is. Starting it takes over the screen: the
 * round is the one thing in this product that is *performed*, with a room
 * waiting on it, so nothing else stays on screen to compete with the person
 * whose turn it is.
 *
 * The round is also where closing happens. A member ticking a line off is a
 * claim — "I have finished this" — and it sits amber until the owner confirms
 * it here. That is what makes the meeting the closing of the day rather than a
 * report on one.
 */
export function MorningMeeting({ board, teams, activeTeam }: {
  board: MeetingBoard;
  teams: Team[];
  activeTeam: Team;
}) {
  const router = useRouter();
  const { run, refreshSoon, inFlight } = useActivity();
  const [minimised, setMinimised] = useState(false);

  const meeting = board.meeting;
  const rows = board.rows;
  const running = meeting.status === "in_progress";
  const finished = meeting.status === "completed";
  /**
   * Whose turn it is, moved locally before the server is told.
   *
   * The round is run in front of the whole team, and a name that changes half a
   * second after the arrow key is pressed reads as the app struggling. Cleared
   * when a new board arrives, which is the server's own answer arriving.
   */
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => setStep(null), [board]);

  const serverIndex = Math.min(meeting.current_index, Math.max(rows.length - 1, 0));
  const index = step === null ? serverIndex : Math.min(Math.max(step, 0), Math.max(rows.length - 1, 0));
  const current = rows[index];

  const refresh = refreshSoon;

  /**
   * Moving the meeting along.
   *
   * Advancing to the next person is the action taken most often in this
   * product and it used to wait on a write and then a full route re-render
   * before the name on screen changed — a stutter in front of six people
   * watching. It is sent in the background now; the failure, if there is one,
   * arrives in the tray naming the step that did not take.
   */
  const act = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => {
      if (action === "advance") {
        const to = typeof extra.index === "number" ? extra.index : null;
        setStep((at) => (to !== null ? to : (at ?? serverIndex) + 1));
      }
      run({
        key: `meeting:${meeting.id}:${action}`,
        pending: LABELS[action]?.pending ?? "Working",
        done: LABELS[action]?.done ?? "Done",
        failed: LABELS[action]?.failed ?? "That step did not save",
        method: "POST",
        path: `/api/daily/meeting/action/${meeting.id}`,
        body: { action, ...extra },
      });
    },
    [meeting.id, run, serverIndex],
  );

  // Only the two steps that genuinely change the shape of the screen block
  // their own button. Everything else on the round is optimistic, so a disabled
  // Next while a note saves in the background would be a stutter for nothing.
  const busy = inFlight.has(`meeting:${meeting.id}:start`)
    || inFlight.has(`meeting:${meeting.id}:complete`);

  const totalPending = rows.reduce((n, r) => n + r.pending.length, 0);
  const totalStale = rows.reduce((n, r) => n + r.stale_count, 0);
  const totalOverdue = rows.reduce((n, r) => n + r.overdue_tasks.length, 0);
  const reviewed = rows.filter((r) => r.note?.is_reviewed).length;

  if (running && !minimised && current) {
    return (
      <FullScreenRound
        rows={rows}
        index={index}
        date={meeting.date}
        meetingId={meeting.id}
        teamName={activeTeam.name}
        busy={busy}
        act={act}
        onChanged={refresh}
        onMinimise={() => setMinimised(true)}
      />
    );
  }

  return (
    <>
      <header className="page-head dawn">
        <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
          <div className="stack gap-2">
            <span className="eyebrow">
              {weekday(meeting.date)} · {longDate(meeting.date)} · {activeTeam.name}
            </span>
            <h1>
              {finished
                ? "That's the round done."
                : running
                  ? `${current?.user.display_name}'s turn.`
                  : "Ready when you are."}
            </h1>
            <p className="soft" style={{ fontSize: ".93rem", maxWidth: "54ch" }}>
              {finished
                ? `${reviewed} of ${rows.length} ${plural(rows.length, "person", "people")} reviewed${meeting.duration_minutes != null ? ` in ${meeting.duration_minutes} minutes` : ""}.`
                : `${totalPending} ${plural(totalPending, "thing")} carried in, ${totalOverdue} overdue ${plural(totalOverdue, "task")}${totalStale > 0 ? `, ${totalStale} that ${plural(totalStale, "has", "have")} been sitting for days` : ""}.`}
            </p>
          </div>

          <div className="row gap-2 center">
            {teams.length > 1 && (
              <select
                className="field"
                style={{ width: "auto" }}
                value={activeTeam.id}
                onChange={(e) => router.push(`/morning?team=${e.target.value}`)}
                aria-label="Which team"
              >
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {!running && !finished && (
              <button className="btn btn-primary btn-lg" disabled={busy || rows.length === 0}
                      onClick={() => { setMinimised(false); act("start"); }}>
                {busy && <span className="spin" />}
                Start morning meeting
              </button>
            )}
            {running && minimised && (
              <>
                <button className="btn btn-primary btn-lg"
                        onClick={() => setMinimised(false)}>
                  Back to the round
                </button>
                <button className="btn btn-lg" disabled={busy}
                        onClick={() => act("complete")}>
                  Finish early
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="page-body">
        {finished
          ? <Summary rows={rows} onReopen={() => { setMinimised(false); act("start"); }} busy={busy} />
          : <Board rows={rows} />}
      </div>
    </>
  );
}

/* ==========================================================================
   The round, full screen
   ========================================================================== */

function FullScreenRound({
  rows, index, date, meetingId, teamName, busy, act, onChanged, onMinimise,
}: {
  rows: MeetingRow[];
  index: number;
  date: string;
  meetingId: number;
  teamName: string;
  busy: boolean;
  act: (action: string, extra?: Record<string, unknown>) => void;
  onChanged: () => void;
  onMinimise: () => void;
}) {
  // Last meeting's pointers, open by default: the question the owner cannot
  // answer from memory by Thursday is what was agreed on Tuesday. Closable,
  // because on a narrow screen or a shared display it is the first thing to go.
  const [aside, setAside] = useState(true);
  const [native, setNative] = useState(false);
  const row = rows[index];
  const last = row.last_meeting;

  // Arrow keys move the round. A meeting is driven from the keyboard because
  // the owner is talking, not aiming a mouse.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "ArrowRight" && index < rows.length - 1) act("advance");
      if (event.key === "ArrowLeft" && index > 0) act("advance", { index: index - 1 });
      if (event.key === "Escape") onMinimise();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, rows.length, act, onMinimise]);

  // The page behind must not scroll while the round has the screen.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    function onChange() { setNative(Boolean(document.fullscreenElement)); }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleNative() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Some browsers refuse outside a gesture they recognise. The overlay is
      // already full-bleed, so this is a nicety rather than the mechanism.
    }
  }

  return (
    <div className="fs" role="dialog" aria-modal="true" aria-label={`Morning meeting, ${teamName}`}>
      <div className="fs-top">
        <div className="stack gap-1" style={{ minWidth: 170 }}>
          <span className="eyebrow">{teamName} · {weekday(date)}</span>
          <strong style={{ fontSize: ".95rem", fontFamily: "var(--display)" }}>
            Morning meeting
          </strong>
        </div>

        <div className="fs-progress" aria-hidden>
          {rows.map((r, i) => (
            <i key={r.user.id}
               data-state={i < index ? "past" : i === index ? "now" : "ahead"} />
          ))}
        </div>

        <span className="mono faint" style={{ fontSize: ".78rem", whiteSpace: "nowrap" }}>
          {index + 1} / {rows.length}
        </span>

        <div className="row gap-1 center">
          <button className="btn btn-sm" onClick={() => setAside((a) => !a)}
                  aria-pressed={aside}>
            {aside ? "Hide pointers" : "Show pointers"}
          </button>
          <button className="btn btn-sm" onClick={toggleNative}>
            {native ? "Exit full screen" : "Full screen"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onMinimise}>Minimise</button>
          <button className="btn btn-sm" disabled={busy} onClick={() => act("complete")}>
            Finish
          </button>
        </div>
      </div>

      <div className="fs-body" data-aside={aside && Boolean(last)}>
        {/* Everybody's name, up at once: the room can see the running order
            before the first turn starts, and anyone can be jumped to. */}
        <div className="fs-col fs-roster">
          <span className="eyebrow" style={{ padding: "2px 11px 10px", display: "block" }}>
            The round
          </span>
          {rows.map((r, i) => (
              <button
                key={r.user.id}
                className="seat-name pop"
                style={{ animationDelay: `${i * 55}ms` }}
                data-current={i === index}
                data-past={i < index}
                onClick={() => act("advance", { index: i })}
                disabled={busy}
              >
                <Avatar name={r.user.display_name}
                        url={r.user.gitlab_avatar_url || undefined} />
                <span className="stack grow" style={{ minWidth: 0 }}>
                  <span className="seat-label">
                    {r.user.display_name}
                    {r.is_owner && <span className="faint"> · you</span>}
                  </span>
                  <span className="faint" style={{ fontSize: ".7rem" }}>
                    {r.pending.length} open
                  </span>
                </span>
                {r.note?.is_reviewed && (
                  <span className="dot" style={{ background: "var(--done)" }} />
                )}
              </button>
          ))}
        </div>

        <div className="fs-col fs-stage">
          <TurnCard key={row.user.id} row={row} date={date} meetingId={meetingId}
                    onChanged={onChanged} />
        </div>

        {aside && last && (
          <div className="fs-col fs-aside" key={`aside-${row.user.id}`}>
            <LastMeetingPanel row={row} />
          </div>
        )}
      </div>

      <div className="fs-bottom">
        <button className="btn" disabled={index === 0}
                onClick={() => act("advance", { index: index - 1 })}>
          ← Back
        </button>
        <span className="faint" style={{ fontSize: ".78rem" }}>
          Arrow keys move the round · Esc minimises
        </span>
        {index >= rows.length - 1 ? (
          <button className="btn btn-primary" disabled={busy}
                  onClick={() => act("complete")}>
            {busy && <span className="spin" />}
            Publish the day
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => act("advance")}>
            Next person →
          </button>
        )}
      </div>
    </div>
  );
}

/** What was said about this person last time, and whether it happened. */
function LastMeetingPanel({ row }: { row: MeetingRow }) {
  const last = row.last_meeting;
  if (!last) {
    return (
      <p className="faint" style={{ fontSize: ".84rem" }}>
        This is the first meeting with {row.user.display_name}.
      </p>
    );
  }

  const kept = last.total > 0 ? Math.round((last.closed / last.total) * 100) : 0;

  return (
    <div className="stack gap-3">
      <div className="stack gap-1">
        <span className="eyebrow">Last meeting</span>
        <strong style={{ fontSize: ".95rem", fontFamily: "var(--display)" }}>
          {shortDate(last.date)}
        </strong>
        <span className="faint" style={{ fontSize: ".75rem" }}>
          {last.days_ago === 1 ? "yesterday" : `${last.days_ago} days ago`}
          {!last.attended && " · did not attend"}
        </span>
      </div>

      <div className="row gap-3 wrap">
        <span className="stack">
          <span className="mono" style={{ fontSize: "1.15rem", fontWeight: 600 }}>
            {last.closed}/{last.total}
          </span>
          <span className="faint" style={{ fontSize: ".7rem" }}>closed since</span>
        </span>
        <span className="stack">
          <span className="mono" style={{ fontSize: "1.15rem", fontWeight: 600,
                        color: last.still_open ? "var(--attention)" : "var(--done)" }}>
            {last.still_open}
          </span>
          <span className="faint" style={{ fontSize: ".7rem" }}>still open</span>
        </span>
        <span className="stack">
          <span className="mono" style={{ fontSize: "1.15rem", fontWeight: 600 }}>{kept}%</span>
          <span className="faint" style={{ fontSize: ".7rem" }}>kept</span>
        </span>
      </div>

      {last.blockers && (
        <div className="stack gap-1" style={{ padding: "10px 12px", borderRadius: 10,
                     background: "var(--attention-wash)", color: "var(--attention)" }}>
          <span className="eyebrow" style={{ color: "inherit" }}>Was blocked on</span>
          <span style={{ fontSize: ".84rem" }}>{last.blockers}</span>
        </div>
      )}

      {last.notes && (
        <div className="stack gap-1">
          <span className="eyebrow">Note taken</span>
          <span className="soft" style={{ fontSize: ".84rem" }}>{last.notes}</span>
        </div>
      )}

      <div className="stack gap-1">
        <span className="eyebrow">What was on the list</span>
        {last.todos.length === 0 && (
          <span className="faint" style={{ fontSize: ".82rem" }}>Nothing was written down.</span>
        )}
        {last.todos.map((todo) => (
          <span key={todo.id} className="row gap-2"
                style={{ fontSize: ".82rem", alignItems: "flex-start", padding: "3px 0" }}>
            <span className="dot" style={{
              marginTop: 7,
              background: todo.status === "closed" ? "var(--done)"
                : "var(--line-firm)",
            }} />
            <span style={{
              color: todo.status === "closed" ? "var(--ink-faint)" : "var(--ink-soft)",
              textDecoration: todo.status === "closed" ? "line-through" : undefined,
            }}>
              {todo.title}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * What each meeting step is called, in the words the buttons use.
 *
 * Kept here rather than at the call sites so a failure notification says
 * "Could not publish the day" — the thing the person pressed — instead of
 * naming the action verb the API happens to use.
 */
const LABELS: Record<string, { pending: string; done: string; failed: string }> = {
  start: { pending: "Starting the round", done: "Round started",
           failed: "Could not start the round" },
  advance: { pending: "Moving on", done: "Moved on",
             failed: "The round did not move on" },
  complete: { pending: "Publishing the day", done: "The day is published",
              failed: "Could not publish the day" },
  record: { pending: "Saving", done: "Saved", failed: "Could not save that note" },
};

/** The person whose turn it is, at full size. */
function TurnCard({ row, date, meetingId, onChanged }: {
  row: MeetingRow;
  date: string;
  meetingId: number;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { run, refreshSoon, inFlight } = useActivity();
  const [draft, setDraft] = useState("");
  const [blockers, setBlockers] = useState(row.note?.blockers ?? "");
  const [reopening, setReopening] = useState<Todo | null>(null);

  /**
   * Where each todo has been moved to but the server has not confirmed it.
   *
   * The two lists on this screen — still open, closed today — are one list of
   * todos bucketed by status, so an optimistic move is just an overridden
   * status and a re-bucket. Closing all of somebody's open work is one click
   * and N requests; this is what lets all N rows move at once instead of
   * trickling in as each one lands.
   */
  const [moved, setMoved] = useState<Record<number, Todo["status"]>>({});
  const [extra, setExtra] = useState<Todo[]>([]);
  useEffect(() => { setMoved({}); setExtra([]); }, [row]);

  const buckets = useMemo(() => {
    const all = [...row.pending, ...row.done, ...extra].map((todo) =>
      moved[todo.id]
        ? { ...todo, status: moved[todo.id], is_done: moved[todo.id] === "closed" }
        : todo);
    return {
      pending: all.filter((t) => t.status === "open"),
      done: all.filter((t) => t.status === "closed"),
    };
  }, [row, moved, extra]);

  function move(todo: Todo, status: Todo["status"], body: Record<string, unknown>,
                done: string, failed: string) {
    setMoved((all) => ({ ...all, [todo.id]: status }));
    run({
      key: `todo:${todo.id}:tick`,
      pending: done,
      done,
      failed,
      method: "PATCH",
      path: `/api/daily/todos/${todo.id}`,
      body,
    });
  }

  const close = (todo: Todo) =>
    move(todo, "closed", { done: true },
         `Closed “${todo.title}”`, `Could not close “${todo.title}”`);

  const reopen = (todo: Todo) =>
    move(todo, "open", { done: false },
         `Reopened “${todo.title}”`, `Could not reopen “${todo.title}”`);

  function closeAllOpen() {
    const batch = buckets.pending;
    if (batch.length === 0) return;
    // Every one is its own request, and every one can fail on its own — so each
    // gets its own notification naming the line rather than one "some of that
    // did not work" that nobody can act on.
    batch.forEach(close);
  }

  function addTodo(title: string, taskId?: number) {
    const text = title.trim();
    if (!text) return;
    setExtra((all) => [...all, {
      id: -Date.now() - all.length,
      title: text,
      status: "open",
      is_done: false,
      is_stale: false,
      carry_count: 0,
      source: "meeting",
      task: null,
      closed_by_name: null,
    } as unknown as Todo]);
    setDraft("");
    run({
      key: `todo:add:${row.user.id}:${text}`,
      pending: `Adding “${text}”`,
      done: `Added “${text}” for ${row.user.display_name}`,
      failed: `Could not add “${text}” for ${row.user.display_name}`,
      method: "POST",
      path: "/api/daily/todos",
      body: { title: text, date, user_id: row.user.id, task_id: taskId ?? null },
    });
  }

  function saveNote() {
    run({
      key: `meeting:${meetingId}:note:${row.user.id}`,
      pending: "Saving the note",
      done: `Noted for ${row.user.display_name}`,
      failed: `Could not save the note for ${row.user.display_name}`,
      method: "POST",
      path: `/api/daily/meeting/action/${meetingId}`,
      body: { action: "record", user_id: row.user.id, blockers },
    });
  }

  return (
    <div className="stack gap-4" style={{ maxWidth: 760, margin: "0 auto" }}>
      {reopening && (
        <Confirm
          title="Reopen this?"
          body={`“${reopening.title}” was closed today. Reopening puts it back on ${row.user.display_name}'s list as unfinished.`}
          confirmLabel="Reopen it"
          tone="attention"
          onCancel={() => setReopening(null)}
          onConfirm={() => { reopen(reopening); setReopening(null); }}
        />
      )}

      <div className="row gap-4 center wrap">
        <Avatar name={row.user.display_name} large
                url={row.user.gitlab_avatar_url || undefined} />
        <div className="stack gap-1 grow">
          <h1 style={{ fontSize: "1.7rem" }}>
            {row.user.display_name}
            {row.is_owner && <span className="faint" style={{ fontWeight: 400 }}> · you</span>}
          </h1>
          <span className="faint" style={{ fontSize: ".82rem" }}>
            {row.user.job_title || row.user.department}
          </span>
        </div>
        {row.note?.is_reviewed && <span className="pill pill-done">reviewed</span>}
        <Link href={`/team/${row.user.id}`} className="btn btn-sm">Their history</Link>
      </div>

      {(row.stale_count > 0 || row.overdue_tasks.length > 0) && (
        <div className="row gap-2 center" style={{ padding: "10px 14px", borderRadius: 10,
                     background: "var(--attention-wash)", color: "var(--attention)",
                     fontSize: ".84rem" }}>
          <span className="dot pulse-dot" style={{ background: "currentColor" }} />
          <span>
            {[
              row.stale_count > 0 && `${row.stale_count} carrying for days`,
              row.overdue_tasks.length > 0 && `${row.overdue_tasks.length} overdue ${plural(row.overdue_tasks.length, "task")}`,
            ].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}

      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="panel-head">
          <div className="stack">
            <h2 style={{ fontSize: "1rem" }}>Still open</h2>
            {buckets.pending.length > 0 && (
              <span className="faint" style={{ fontSize: ".77rem" }}>
                Anything settled in the round can be ticked here.
              </span>
            )}
          </div>
          <span className="row gap-2 center">
            <span className="mono faint" style={{ fontSize: ".78rem" }}>
              {buckets.pending.length}
            </span>
            {buckets.pending.length > 1 && (
              <button className="btn btn-sm" onClick={closeAllOpen}>Tick all off</button>
            )}
          </span>
        </div>
        <div className="stack">
          {buckets.pending.map((todo) => (
            <MeetingTodo key={todo.id} todo={todo}
                         busy={inFlight.has(`todo:${todo.id}:tick`)}
                         onClose={() => close(todo)} />
          ))}
          {buckets.pending.length === 0 && (
            <p className="faint" style={{ padding: "18px", fontSize: ".85rem" }}>
              Nothing open. Everything on the list has been dealt with.
            </p>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addTodo(draft); }}
              className="row gap-2" style={{ padding: "12px 16px",
                                             borderTop: "1px solid var(--line)" }}>
          <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)}
                 placeholder={`Agree something new for ${row.user.display_name} today`} />
          <button className="btn btn-primary btn-sm" disabled={!draft.trim()}>
            Add
          </button>
        </form>
      </section>

      {buckets.done.length > 0 && (
        <section className="panel" style={{ overflow: "hidden" }}>
          <div className="panel-head">
            <h2 style={{ fontSize: "1rem" }}>Closed today</h2>
            <span className="mono faint" style={{ fontSize: ".78rem" }}>{buckets.done.length}</span>
          </div>
          <div className="stack">
            {buckets.done.map((todo) => (
              <MeetingTodo key={todo.id} todo={todo}
                           busy={inFlight.has(`todo:${todo.id}:tick`)}
                           onReopen={() => setReopening(todo)} />
            ))}
          </div>
        </section>
      )}

      {row.suggestions.length > 0 && (
        <section className="panel" style={{ overflow: "hidden" }}>
          <div className="panel-head">
            <div className="stack">
              <h2 style={{ fontSize: "1rem" }}>Could pick up</h2>
              <span className="faint" style={{ fontSize: ".77rem" }}>
                Open GitLab tasks assigned to them, soonest due first
              </span>
            </div>
          </div>
          <div className="stack">
            {row.suggestions.map((task) => (
              <div key={task.id} className="todo">
                <span className="stack grow gap-1">
                  <span style={{ fontSize: ".87rem" }}>{task.title}</span>
                  <span className="row gap-2 center" style={{ fontSize: ".72rem" }}>
                    <span className="faint">{task.project_name}</span>
                    <span className="mono" style={{
                      color: task.is_overdue ? "var(--overdue)" : "var(--ink-faint)" }}>
                      {relativeDue(task.due_date)}
                    </span>
                  </span>
                </span>
                <button className="btn btn-sm"
                        onClick={() => addTodo(task.title, task.id)}>
                  Add to today
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <label className="lbl">
        Anything blocking them?
        <textarea className="field" rows={2} value={blockers}
                  onChange={(e) => setBlockers(e.target.value)}
                  onBlur={saveNote}
                  placeholder="Written down here, it shows up beside their name tomorrow." />
      </label>
    </div>
  );
}

/**
 * One line in the round.
 *
 * Three states, three colours. Amber is the one that matters: it means somebody
 * said this was finished and nobody has agreed yet.
 */
function MeetingTodo({ todo, busy, onClose, onReject, onReopen }: {
  todo: Todo;
  busy: boolean;
  onClose?: () => void;
  onReject?: () => void;
  onReopen?: () => void;
}) {
  const closed = todo.status === "closed";

  return (
    <div className="todo" data-done={closed}>
      <button
        className="check"
        data-done={closed}
        disabled={busy || (!onClose && !onReopen)}
        onClick={closed ? onReopen : onClose}
        aria-label={closed ? `Reopen ${todo.title}` : `Close ${todo.title}`}
      >
        <Tick />
      </button>

      <Thread days={todo.carry_count} stale={todo.is_stale} />

      <span className="grow stack gap-1">
        <span className="todo-title">{todo.title}</span>
        <span className="row gap-2 center wrap" style={{ fontSize: ".72rem" }}>
          {closed && todo.closed_by_name && (
            <span className="faint">closed by {todo.closed_by_name}</span>
          )}
          {todo.task && (
            <a href={todo.task.web_url} target="_blank" rel="noreferrer"
               className="mono" style={{ color: "var(--brand)" }}>
              #{todo.task.gitlab_iid}
            </a>
          )}
          {todo.carry_count > 0 && (
            <span className="faint">
              carried {todo.carry_count} {todo.carry_count === 1 ? "day" : "days"}
            </span>
          )}
        </span>
      </span>

    </div>
  );
}

/* ==========================================================================
   Before and after
   ========================================================================== */

/**
 * The pre-meeting picture: everybody at once.
 *
 * Read-only on purpose. Ticking things off before the round has started is how
 * a standup turns into a form somebody fills in beforehand; the board is for
 * walking in already knowing where the trouble is, and the round is where the
 * day is actually settled.
 */
function Board({ rows }: { rows: MeetingRow[] }) {
  return (
    <div className="grid cols-auto stretch">
      {rows.map((row, index) => (
        <div key={row.user.id} className="rise" style={{ animationDelay: `${index * 55}ms` }}>
          <BoardCard row={row} />
        </div>
      ))}
      {rows.length === 0 && (
        <div className="panel" style={{ gridColumn: "1 / -1", padding: 30, textAlign: "center" }}>
          <span className="faint">Nobody is on this team yet.</span>
        </div>
      )}
    </div>
  );
}

function BoardCard({ row }: { row: MeetingRow }) {
  return (
    <div className="panel stack" style={{ overflow: "hidden", height: "100%" }}>
      <div className="row gap-3 center" style={{ padding: "14px 16px",
                                                 borderBottom: "1px solid var(--line)" }}>
        <Avatar name={row.user.display_name}
                url={row.user.gitlab_avatar_url || undefined} />
        <span className="stack grow">
          <span style={{ fontWeight: 600, fontSize: ".9rem" }}>
            {row.user.display_name}
            {row.is_owner && <span className="faint" style={{ fontWeight: 400 }}> · you</span>}
          </span>
          <span className="faint" style={{ fontSize: ".75rem" }}>
            {row.user.job_title || row.user.department}
          </span>
        </span>
      </div>

      <div className="row gap-4" style={{ padding: "12px 16px", fontSize: ".76rem" }}>
        <span className="stack">
          <span className="mono" style={{ fontSize: "1rem", fontWeight: 600 }}>
            {row.pending.length}
          </span>
          <span className="faint">open</span>
        </span>
        <span className="stack">
          <span className="mono" style={{ fontSize: "1rem", fontWeight: 600,
                        color: row.pending.length ? "var(--attention)" : undefined }}>
            {row.pending.length}
          </span>
          <span className="faint">to close</span>
        </span>
        <span className="stack">
          <span className="mono" style={{ fontSize: "1rem", fontWeight: 600,
                        color: row.done.length ? "var(--done)" : undefined }}>
            {row.done.length}
          </span>
          <span className="faint">closed</span>
        </span>
        <span className="stack">
          <span className="mono" style={{ fontSize: "1rem", fontWeight: 600,
                        color: row.overdue_tasks.length ? "var(--overdue)" : undefined }}>
            {row.overdue_tasks.length}
          </span>
          <span className="faint">overdue</span>
        </span>
      </div>

      <div className="stack grow" style={{ maxHeight: 190, overflowY: "auto" }}>
        {row.pending.slice(0, 4).map((todo) => (
          <div key={todo.id} className="todo" style={{ padding: "7px 16px" }}>
            <Thread days={todo.carry_count} stale={todo.is_stale} />
            <span className="grow todo-title" style={{ fontSize: ".83rem" }}>{todo.title}</span>
          </div>
        ))}
        {row.pending.length === 0 && (
          <p className="faint" style={{ padding: "12px 16px", fontSize: ".82rem" }}>
            Nothing open on their list.
          </p>
        )}
      </div>

      {row.last_meeting?.blockers && (
        <span style={{ padding: "9px 16px", fontSize: ".77rem", color: "var(--attention)",
                       borderTop: "1px solid var(--line)" }}>
          Was blocked: {row.last_meeting.blockers}
        </span>
      )}

      <Link href={`/team/${row.user.id}`} className="btn btn-ghost btn-sm"
            style={{ margin: "0 12px 12px", justifyContent: "flex-start" }}>
        Open their day →
      </Link>
    </div>
  );
}

function Summary({ rows, onReopen, busy }: {
  rows: MeetingRow[];
  onReopen: () => void;
  busy: boolean;
}) {
  const blocked = rows.filter((r) => r.note?.blockers);
  const stillOpen = rows.reduce((n, r) => n + r.pending.length, 0);
  const closed = rows.reduce((n, r) => n + r.done.length, 0);

  return (
    <div className="stack gap-4">
      <section className="grid cols-stat">
        <div className="panel stack gap-1" style={{ padding: 16 }}>
          <span className="mono" style={{ fontSize: "1.6rem", fontWeight: 600,
                        color: "var(--done)" }}>{closed}</span>
          <span className="faint" style={{ fontSize: ".77rem" }}>closed in the round</span>
        </div>
        <div className="panel stack gap-1" style={{ padding: 16 }}>
          <span className="mono" style={{ fontSize: "1.6rem", fontWeight: 600 }}>{stillOpen}</span>
          <span className="faint" style={{ fontSize: ".77rem" }}>carried into today</span>
        </div>
        <div className="panel stack gap-1" style={{ padding: 16 }}>
          <span className="mono" style={{ fontSize: "1.6rem", fontWeight: 600,
                        color: blocked.length ? "var(--attention)" : undefined }}>
            {blocked.length}
          </span>
          <span className="faint" style={{ fontSize: ".77rem" }}>blocked</span>
        </div>
      </section>

      <div className="panel rise" style={{ overflow: "hidden" }}>
        <div className="panel-head">
          <h2 style={{ fontSize: "1.05rem" }}>What everyone is doing</h2>
          <button className="btn btn-sm" onClick={onReopen} disabled={busy}>
            Reopen the round
          </button>
        </div>
        <div className="stack">
          {rows.map((row) => (
            <div key={row.user.id} className="row gap-3"
                 style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)",
                          alignItems: "flex-start" }}>
              <Avatar name={row.user.display_name}
                      url={row.user.gitlab_avatar_url || undefined} />
              <span className="stack grow gap-1">
                <span style={{ fontSize: ".88rem", fontWeight: 500 }}>
                  {row.user.display_name}
                </span>
                {row.pending.length > 0 ? (
                  <span className="soft" style={{ fontSize: ".83rem" }}>
                    {row.pending.map((t) => t.title).join(" · ")}
                  </span>
                ) : (
                  <span className="faint" style={{ fontSize: ".83rem" }}>
                    Nothing open on their list.
                  </span>
                )}
                {row.note?.blockers && (
                  <span style={{ fontSize: ".81rem", color: "var(--attention)" }}>
                    Blocked: {row.note.blockers}
                  </span>
                )}
              </span>
              <Link href={`/team/${row.user.id}`} className="btn btn-ghost btn-sm">Open</Link>
            </div>
          ))}
        </div>
      </div>

      {blocked.length > 0 && (
        <div className="panel rise" style={{ borderColor: "var(--attention)",
                                             animationDelay: "80ms" }}>
          <div className="panel-head">
            <h2 style={{ fontSize: "1rem", color: "var(--attention)" }}>
              {blocked.length} {plural(blocked.length, "blocker")} to clear
            </h2>
          </div>
          <div className="stack">
            {blocked.map((row) => (
              <div key={row.user.id} className="stack gap-1"
                   style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
                <span className="eyebrow">{row.user.display_name}</span>
                <span style={{ fontSize: ".86rem" }}>{row.note?.blockers}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
