"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Phase } from "@/lib/types";

/**
 * Where a project has got to, and moving it on.
 *
 * A dropdown would be the obvious control and the wrong one. The nine phases
 * are a sequence, not a set — the useful question on opening a project is "how
 * far along is this", which a list of names cannot answer and a track can. So
 * the closed state is a rung on a ladder, and the open state names every rung
 * with the current one marked.
 *
 * The phases come from the backend rather than a copy kept here, so the order
 * is declared once.
 */
export function PhasePicker({ projectId, status, statusDisplay, phaseIndex, phaseCount, canEdit }: {
  projectId: number;
  status: string;
  statusDisplay: string;
  phaseIndex: number;
  phaseCount: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open || phases.length) return;
    fetch("/api/proxy/api/projects/phases/")
      .then((r) => (r.ok ? r.json() : { phases: [] }))
      .then((data) => setPhases(data.phases ?? []))
      .catch(() => setPhases([]));
  }, [open, phases.length]);

  /**
   * Where to put the menu, in viewport coordinates.
   *
   * It is rendered at the document root rather than beside the button, and
   * measured here. The header carries `.dawn`, which sets `isolation: isolate`
   * — a stacking context — so a menu positioned inside it is trapped there and
   * the page below paints straight over it. Only the first row or two survived,
   * which read as the phase list containing nothing but its current value.
   */
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) setAt({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on a click elsewhere or on Escape, the two ways anybody expects a
  // popover to go away.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      // The menu lives outside this component's DOM subtree now, so it has to
      // be asked separately whether the click landed inside it.
      if (box.current?.contains(target)) return;
      if (menu.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function move(next: string) {
    if (next === status) { setOpen(false); return; }
    setBusy(next);
    setFailure(null);

    const res = await fetch(`/api/proxy/api/projects/${projectId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setFailure(body?.detail ?? "That phase could not be set.");
      return;
    }
    setOpen(false);
    startTransition(() => router.refresh());
  }

  const done = status === "closed";
  const tone = done ? "var(--ink-faint)" : "var(--brand)";

  return (
    <div ref={box} className="stack gap-2" style={{ position: "relative", minWidth: 190 }}>
      <div className="row between center gap-2">
        <span className="eyebrow">Phase</span>
        <span className="mono faint" style={{ fontSize: ".72rem" }}>
          {phaseIndex + 1}/{phaseCount}
        </span>
      </div>

      <button
        ref={anchor}
        className="phase-button"
        onClick={() => canEdit && setOpen((o) => !o)}
        disabled={!canEdit}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={canEdit ? "Move this project on" : undefined}
      >
        <span className="phase-name" style={{ color: tone }}>{statusDisplay}</span>
        {canEdit && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
               className="chev" data-open={open} aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {/* The ladder. Rungs behind the current phase are filled, so how far along
          the project is reads without anybody counting. */}
      <span className="rungs" role="img"
            aria-label={`Phase ${phaseIndex + 1} of ${phaseCount}`}>
        {Array.from({ length: phaseCount }, (_, i) => (
          <i key={i} data-state={i < phaseIndex ? "past" : i === phaseIndex ? "now" : "ahead"}
             data-closed={done} />
        ))}
      </span>

      {failure && (
        <span style={{ fontSize: ".75rem", color: "var(--overdue)" }}>{failure}</span>
      )}

      {open && at && createPortal(
        <div ref={menu} className="phase-menu" role="listbox" aria-label="Delivery phase"
             style={{ top: at.top, right: at.right }}>
          {phases.length === 0 && (
            <span className="faint" style={{ padding: "10px 12px", fontSize: ".8rem" }}>
              Loading…
            </span>
          )}
          {phases.map((phase) => (
            <button
              key={phase.value}
              role="option"
              aria-selected={phase.value === status}
              className="phase-option"
              data-current={phase.value === status}
              data-past={phase.index < phaseIndex}
              disabled={busy !== null}
              onClick={() => move(phase.value)}
            >
              <span className="phase-dot" data-state={
                phase.index < phaseIndex ? "past" : phase.index === phaseIndex ? "now" : "ahead"
              } />
              <span className="grow">{phase.label}</span>
              {busy === phase.value && <span className="spin" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
