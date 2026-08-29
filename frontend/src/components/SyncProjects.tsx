"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Project } from "@/lib/types";

/**
 * Pull every project's plan back from GitLab.
 *
 * Opening a project already reconciles it, which is enough while you are
 * working in one. This is for the other case: a repository that was planned
 * entirely in GitLab, or several that were, where nothing here has seen the
 * milestones yet and the list would otherwise report empty plans for work that
 * is visibly there.
 *
 * The loop is on the client, one call per project, rather than one request that
 * does all of them. Each project means several round trips to GitLab, so a
 * dozen of them is long enough that a silent spinner stops being credible —
 * counting up says the same thing and stays honest about how far it has got.
 */
const AT_A_TIME = 3;

type Result = { milestones: number; tasks: number; todos_completed: number; error?: string };

export function SyncProjects({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [report, setReport] = useState<{
    milestones: number; tasks: number; failed: string[];
  } | null>(null);

  async function syncOne(project: Project): Promise<Result> {
    try {
      const res = await fetch(`/api/proxy/api/planning/reconcile/${project.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return { milestones: 0, tasks: 0, todos_completed: 0, error: "refused" };
      return await res.json();
    } catch {
      return { milestones: 0, tasks: 0, todos_completed: 0, error: "unreachable" };
    } finally {
      setDone((n) => n + 1);
    }
  }

  async function sync() {
    setRunning(true);
    setDone(0);
    setReport(null);

    let milestones = 0;
    let tasks = 0;
    const failed: string[] = [];

    // A few at a time: sequential is needlessly slow across a dozen projects,
    // and all at once would open a dozen concurrent conversations with GitLab.
    const queue = [...projects];
    async function worker() {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const result = await syncOne(next);
        if (result.error) failed.push(next.name);
        milestones += result.milestones ?? 0;
        tasks += result.tasks ?? 0;
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(AT_A_TIME, projects.length) }, worker),
    );

    setReport({ milestones, tasks, failed });
    setRunning(false);
    startTransition(() => router.refresh());
  }

  if (projects.length === 0) return null;

  return (
    <div className="stack gap-2" style={{ alignItems: "flex-end" }}>
      <button className="btn" onClick={sync} disabled={running}>
        {running ? <span className="spin" /> : <SyncIcon />}
        {running ? `Syncing ${done}/${projects.length}…` : "Sync with GitLab"}
      </button>

      {report && (
        <span className="fade" style={{ fontSize: ".76rem", textAlign: "right",
                                        maxWidth: "34ch" }}>
          <span className="faint">
            {report.milestones} {report.milestones === 1 ? "milestone" : "milestones"} and{" "}
            {report.tasks} {report.tasks === 1 ? "task" : "tasks"} read from GitLab.
          </span>
          {report.failed.length > 0 && (
            <span style={{ color: "var(--attention)", display: "block" }}>
              Could not reach {report.failed.join(", ")}.
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function SyncIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16m0 0h4.5M3 16v4.5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8m0 0h-4.5M21 8V3.5" />
    </svg>
  );
}
