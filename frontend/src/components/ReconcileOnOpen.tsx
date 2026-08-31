"use client";

/**
 * Re-read GitLab when a project is opened — without holding up the screen.
 *
 * This used to be awaited during the server render, which made opening a
 * project cost two or more HTTP round trips to GitLab before a single pixel
 * appeared, and made *every* refresh on that screen pay for it again. Ticking
 * one task meant a write, a re-render, and a full reconcile.
 *
 * So the page now renders from what is stored, and the reconcile happens after,
 * from here. The backend throttles it (see `RECONCILE_THROTTLE_SECONDS`), so a
 * burst of refreshes is one GitLab conversation, not one per render. The screen
 * is only re-read if something actually came back changed — a reconcile that
 * found nothing new should cost nothing to look at.
 */

import { useEffect, useRef } from "react";
import { useActivity } from "./Activity";

type Report = {
  milestones?: number;
  tasks?: number;
  todos_completed?: number;
  skipped?: boolean;
};

export function ReconcileOnOpen({ projectId }: { projectId: number | string }) {
  const { refreshSoon } = useActivity();
  // Strict mode mounts effects twice in development, and this one talks to
  // GitLab. Once per mount, genuinely.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/proxy/api/planning/reconcile/${projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok || cancelled) return;
        const report = (await res.json()) as Report;
        if (report.skipped) return;
        const changed =
          (report.milestones ?? 0) + (report.tasks ?? 0) + (report.todos_completed ?? 0);
        if (changed > 0) refreshSoon();
      } catch {
        // A failed background read is not worth a notification: nothing the
        // person did has been lost, and the screen is showing what is stored.
        // The Sync button is there for when they want to know.
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, refreshSoon]);

  return null;
}
