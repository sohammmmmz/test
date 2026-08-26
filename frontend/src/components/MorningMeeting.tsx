"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Avatar, Thread, Tick } from "./ui";
import { longDate, plural, relativeDue, weekday } from "@/lib/format";
import type { MeetingBoard, MeetingRow, Team } from "@/lib/types";

/**
 * The morning meeting.
 *
 * It opens on the board — the whole team side by side, so the owner walks in
 * already knowing where the trouble is. Starting the meeting turns that board
 * into a round: one person at a time, in order, with the rest receding but
 * still visible so it is always clear how much is left.
 *
 * The round is the one place in this product where motion carries meaning
 * rather than decoration: advancing physically moves the team.
 */
export function MorningMeeting({ board, teams, activeTeam }: {
  board: MeetingBoard;
  teams: Team[];
  activeTeam: Team;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const meeting = board.meeting;
  const rows = board.rows;
  const running = meeting.status === "in_progress";
  const finished = meeting.status === "completed";
  const index = Math.min(meeting.current_index, Math.max(rows.length - 1, 0));
  const current = rows[index];

  const refresh = useCallback(
    () => startTransition(() => router.refresh()),
    [router],
  );

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    await fetch(`/api/proxy/api/daily/meeting/action/${meeting.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    setBusy(false);
    refresh();
  }

  // Keep the current seat centred as the round advances.
  //
  // The strip is padded by half the stage rather than clamping the offset at
  // zero: clamping leaves the first two people sitting off to the left, so the
  // round appears to start mid-motion and only centres once it is deep enough.
  useEffect(() => {
    if (!running || !stage.current) return;
    const SEAT = 274; // seat width plus the gap
    const strip = stage.current.firstElementChild as HTMLElement | null;
    if (!strip) return;

    // Anchored left of centre rather than dead centre: at the start of the
    // round there is nobody behind you, and a half-empty screen reads as a
    // layout fault. Sitting at a third also shows more of who is still to
    // come, which is the more useful half.
    const pad = Math.max(0, (stage.current.clientWidth - SEAT) * 0.3);
    strip.style.paddingLeft = `${pad}px`;
    strip.style.paddingRight = `${pad}px`;
    strip.style.transform = `translate3d(${-index * SEAT}px, 0, 0)`;
  }, [index, running, rows.length]);

  const totalPending = rows.reduce((n, r) => n + r.pending.length, 0);
  const totalStale = rows.reduce((n, r) => n + r.stale_count, 0);
  const totalOverdue = rows.reduce((n, r) => n + r.overdue_tasks.length, 0);
  const reviewed = rows.filter((r) => r.note?.is_reviewed).length;

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
                      onClick={() => act("start")}>
                {busy && <span className="spin" />}
                Start morning meeting
              </button>
            )}
            {running && (
              <button className="btn btn-lg" disabled={busy}
                      onClick={() => act("complete")}>
                Finish early
              </button>
            )}
          </div>
        </div>

        {running && (
          <div className="row gap-1" style={{ marginTop: 18 }} aria-hidden>
            {rows.map((row, i) => (
              <span
                key={row.user.id}
                style={{
                  height: 3, flex: 1, borderRadius: 3,
                  background: i < index ? "var(--brand)"
                    : i === index ? "var(--brand)" : "var(--line)",
                  opacity: i === index ? 1 : i < index ? .45 : 1,
                  transition: "background .4s var(--ease), opacity .4s var(--ease)",
                }}
              />
            ))}
          </div>
        )}
      </header>

      <div className="page-body">
        {finished ? (
          <Summary rows={rows} onReopen={() => act("start")} busy={busy} />
        ) : running ? (
          <div className="round-stage" ref={stage}>
            <div className="round">
              {rows.map((row, i) => (
                <div key={row.user.id} className="round-seat"
                     data-current={i === index} data-done={i < index}
                     aria-hidden={i !== index}>
                  <Seat row={row} date={meeting.date} active={i === index}
                        meetingId={meeting.id} onChanged={refresh} />
                </div>
              ))}
            </div>

            <div className="row gap-3 center between" style={{ marginTop: 20 }}>
              <button className="btn" disabled={busy || index === 0}
                      onClick={() => act("advance", { index: index - 1 })}>
                ← Back
              </button>
              <span className="mono faint" style={{ fontSize: ".8rem" }}>
                {index + 1} of {rows.length}
              </span>
              {index >= rows.length - 1 ? (
                <button className="btn btn-primary" disabled={busy}
                        onClick={() => act("complete")}>
                  {busy && <span className="spin" />}
                  Publish the day
                </button>
              ) : (
                <button className="btn btn-primary" disabled={busy}
                        onClick={() => act("advance")}>
                  {busy && <span className="spin" />}
                  Next person →
                </button>
              )}
            </div>
          </div>
        ) : (
          <Board rows={rows} date={meeting.date} meetingId={meeting.id} onChanged={refresh} />
        )}
      </div>
    </>
  );
}

/** The pre-meeting picture: everybody at once. */
function Board({ rows, date, meetingId, onChanged }: {
  rows: MeetingRow[];
  date: string;
  meetingId: number;
  onChanged: () => void;
}) {
  return (
    <div className="grid cols-auto stretch">
      {rows.map((row, index) => (
        <div key={row.user.id} className="rise" style={{ animationDelay: `${index * 55}ms` }}>
          <Seat row={row} date={date} active={false} meetingId={meetingId}
                onChanged={onChanged} compact />
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

/** One person's card — the same component on the board and in the round. */
function Seat({ row, date, active, meetingId, onChanged, compact }: {
  row: MeetingRow;
  date: string;
  active: boolean;
  meetingId: number;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [blockers, setBlockers] = useState(row.note?.blockers ?? "");
  const [busy, setBusy] = useState(false);

  async function addTodo(title: string, taskId?: number) {
    if (!title.trim()) return;
    setBusy(true);
    await fetch("/api/proxy/api/daily/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(), date, user_id: row.user.id, task_id: taskId ?? null,
      }),
    });
    setDraft("");
    setBusy(false);
    onChanged();
  }

  async function toggleTodo(id: number, done: boolean) {
    setBusy(true);
    await fetch(`/api/proxy/api/daily/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    setBusy(false);
    onChanged();
  }

  async function saveNote() {
    setBusy(true);
    await fetch(`/api/proxy/api/daily/meeting/action/${meetingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record", user_id: row.user.id, blockers }),
    });
    setBusy(false);
    onChanged();
  }

  return (
    <div className="panel stack" style={{ overflow: "hidden", height: "100%" }}>
      <div className="row gap-3 center" style={{ padding: "14px 16px",
                                                 borderBottom: "1px solid var(--line)" }}>
        <Avatar name={row.user.display_name} large={active}
                url={row.user.gitlab_avatar_url || undefined} />
        <span className="stack grow">
          <span style={{ fontWeight: 600, fontSize: active ? "1rem" : ".9rem" }}>
            {row.user.display_name}
            {row.is_owner && <span className="faint" style={{ fontWeight: 400 }}> · you</span>}
          </span>
          <span className="faint" style={{ fontSize: ".75rem" }}>
            {row.user.job_title || row.user.department}
          </span>
        </span>
        {row.note?.is_reviewed && <span className="pill pill-done">reviewed</span>}
      </div>

      {(row.stale_count > 0 || row.overdue_tasks.length > 0) && (
        <div className="row gap-2 center" style={{ padding: "8px 16px",
                     background: "var(--attention-wash)", color: "var(--attention)",
                     fontSize: ".78rem" }}>
          <span className="dot" style={{ background: "currentColor" }} />
          <span>
            {[
              row.stale_count > 0 && `${row.stale_count} carrying for days`,
              row.overdue_tasks.length > 0 && `${row.overdue_tasks.length} overdue`,
            ].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}

      <div className="stack grow" style={active ? { maxHeight: 360, overflowY: "auto" } : undefined}>
        {row.pending.length > 0 && (
          <>
            <span className="eyebrow" style={{ padding: "10px 16px 4px" }}>Carried in</span>
            {row.pending.slice(0, active ? 20 : 3).map((todo) => (
              <div key={todo.id} className="todo" style={{ padding: "8px 16px" }}>
                <button className="check" data-done={todo.is_done} disabled={busy}
                        onClick={() => toggleTodo(todo.id, !todo.is_done)}
                        aria-label={`Mark ${todo.title} done`}>
                  <Tick />
                </button>
                <Thread days={todo.carry_count} stale={todo.is_stale} />
                <span className="grow todo-title" style={{ fontSize: ".84rem" }}>
                  {todo.title}
                </span>
              </div>
            ))}
          </>
        )}

        {row.suggestions.length > 0 && (
          <>
            <span className="eyebrow" style={{ padding: "10px 16px 4px" }}>Suggested</span>
            {row.suggestions.slice(0, active ? 6 : 2).map((task) => (
              <div key={task.id} className="todo" style={{ padding: "8px 16px" }}>
                <span className="stack grow gap-1">
                  <span style={{ fontSize: ".84rem" }}>{task.title}</span>
                  <span className="row gap-2 center" style={{ fontSize: ".71rem" }}>
                    <span className="faint" style={{ overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {task.project_name}
                    </span>
                    <span className="mono" style={{ whiteSpace: "nowrap",
                              color: task.is_overdue ? "var(--overdue)" : "var(--ink-faint)" }}>
                      {relativeDue(task.due_date)}
                    </span>
                  </span>
                </span>
                <button className="btn btn-sm" disabled={busy}
                        onClick={() => addTodo(task.title, task.id)}>
                  Add
                </button>
              </div>
            ))}
          </>
        )}

        {row.pending.length === 0 && row.suggestions.length === 0 && (
          <p className="faint" style={{ padding: "18px 16px", fontSize: ".83rem" }}>
            Clear slate. Nothing carried in and nothing outstanding in GitLab.
          </p>
        )}
      </div>

      {active && (
        <div className="stack gap-2" style={{ padding: "12px 16px",
                                              borderTop: "1px solid var(--line)" }}>
          <form onSubmit={(e) => { e.preventDefault(); addTodo(draft); }} className="row gap-2">
            <input className="field" value={draft} onChange={(e) => setDraft(e.target.value)}
                   placeholder="Add something for today" style={{ fontSize: ".83rem" }} />
            <button className="btn btn-primary btn-sm" disabled={busy || !draft.trim()}>Add</button>
          </form>
          <textarea
            className="field"
            rows={2}
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            onBlur={saveNote}
            placeholder="Anything blocking them?"
            style={{ fontSize: ".83rem" }}
          />
        </div>
      )}

      {!active && !compact && <div style={{ height: 12 }} />}

      {compact && (
        <Link href={`/team/${row.user.id}`} className="btn btn-ghost btn-sm"
              style={{ margin: "0 12px 12px", justifyContent: "flex-start" }}>
          Open their day →
        </Link>
      )}
    </div>
  );
}

function Summary({ rows, onReopen, busy }: {
  rows: MeetingRow[];
  onReopen: () => void;
  busy: boolean;
}) {
  const blocked = rows.filter((r) => r.note?.blockers);
  return (
    <div className="stack gap-4">
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
                    Nothing on their list.
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
