"use client";

/**
 * The notification tab: where an action that failed after being confirmed ends
 * up.
 *
 * The list is the point, not the bell. Each line names the action in the words
 * the button used, says what the server said, and — because it kept the request
 * — offers to send it again. A retry that works marks the line as come good
 * rather than deleting it, so a person who saw the badge can see what became
 * of it.
 *
 * Rendered through a portal for the same reason everything else overlaying this
 * app is: the header's stacking context swallows anything positioned inside it.
 */

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActivity } from "./Activity";
import type { AppNotification } from "@/lib/types";

export function NotificationTray() {
  const { notifications, unread, markAllRead, dismiss, retry, clearRead } = useActivity();
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<{ left: number; bottom: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const place = () => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    setSpot({ left: box.left, bottom: window.innerHeight - box.top + 8 });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Opening the tab is reading it. The badge is a prompt to look, and it has
    // done its job the moment somebody does.
    if (next && unread > 0) markAllRead();
  }

  const readCount = notifications.filter((n) => n.is_read).length;

  return (
    <>
      <button
        ref={anchor}
        onClick={toggle}
        className="tray-button"
        data-open={open}
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell active={unread > 0} />
        <span>Notifications</span>
        {unread > 0 && <span className="tray-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && spot && createPortal(
        <div ref={panel} className="tray-panel"
             style={{ left: spot.left, bottom: spot.bottom }}>
          <header className="tray-head">
            <span>Notifications</span>
            {readCount > 0 && (
              <button onClick={clearRead} className="btn btn-ghost btn-sm">Clear read</button>
            )}
          </header>

          {notifications.length === 0 ? (
            <p className="tray-empty">
              Nothing to report. Anything that fails to save turns up here with the
              request kept, so you can send it again.
            </p>
          ) : (
            <ul className="tray-list">
              {notifications.map((note) => (
                <Line key={note.local ? note.dedupe_key : note.id} note={note}
                      onRetry={() => retry(note)} onDismiss={() => dismiss(note)}
                      onNavigate={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function Line({ note, onRetry, onDismiss, onNavigate }: {
  note: AppNotification;
  onRetry: () => void;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const { inFlight } = useActivity();
  const busy = inFlight.has(note.dedupe_key);

  return (
    <li className="tray-item" data-kind={note.is_resolved ? "done" : note.kind}>
      <div className="stack gap-1 grow">
        <span className="tray-title">{note.title}</span>
        {note.body && <span className="tray-body">{note.body}</span>}
        <span className="tray-meta">
          {note.is_resolved
            ? "Sent again, and it worked."
            : note.attempts > 1
              ? `Failed ${note.attempts} times`
              : when(note.updated_at)}
          {note.local && !note.is_resolved && " · held on this device"}
        </span>
        <div className="row gap-2" style={{ marginTop: 2 }}>
          {!note.is_resolved && note.retry_path && (
            <button onClick={onRetry} disabled={busy} className="btn btn-sm">
              {busy ? "Sending…" : "Try again"}
            </button>
          )}
          {note.target_url && (
            <Link href={note.target_url} onClick={onNavigate} className="btn btn-ghost btn-sm">
              Open
            </Link>
          )}
          <button onClick={onDismiss} className="btn btn-ghost btn-sm">Dismiss</button>
        </div>
      </div>
    </li>
  );
}

/** Rough is fine here; the exact second something failed helps nobody. */
function when(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

function Bell({ active }: { active: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2c-2.2 0-3.6 1.6-3.6 3.7 0 2.6-.7 3.4-1.2 4-.3.3-.1.9.4.9h8.8c.5 0 .7-.6.4-.9-.5-.6-1.2-1.4-1.2-4C11.6 3.6 10.2 2 8 2Z"
            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
            fill={active ? "currentColor" : "none"} fillOpacity=".16" />
      <path d="M6.6 13a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.3"
            strokeLinecap="round" />
    </svg>
  );
}
