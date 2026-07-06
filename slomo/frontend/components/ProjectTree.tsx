"use client";

import Link from "next/link";
import type { Project, SessionInfo } from "@/lib/api";

const STACK_ICON: Record<string, string> = {
  blank: "🌿",
  python: "🐍",
  node: "🟩",
  fastapi: "⚡",
  react: "⚛️",
};

interface Props {
  projects: Project[];
  sessions: SessionInfo[];
  onResume: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

export function ProjectTree({ projects, sessions, onResume, onDelete }: Props) {
  if (!projects.length) {
    return (
      <div className="rounded-xl border border-dashed border-canopy-700 p-8 text-center text-cream-500">
        <p className="text-2xl mb-2">🦥</p>
        <p className="text-sm">
          The workspace is empty. Create a project here, or just ask SloMo in the chat.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {projects.map((project) => {
        const live = sessions.find(
          (s) => s.project_id === project.id && s.status === "running",
        );
        return (
          <li
            key={project.id}
            className="rounded-xl border border-canopy-700 bg-canopy-900 px-4 py-3 flex items-center gap-3"
          >
            <span className="text-lg" aria-hidden>
              {STACK_ICON[project.stack] ?? "🌿"}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/workspace/${project.id}`}
                className="font-medium text-cream-100 hover:text-moss-300 transition-colors duration-300 ease-sloth"
              >
                {project.name}
              </Link>
              <p className="text-xs text-cream-500 truncate">
                {project.stack}
                {project.description ? ` · ${project.description}` : ""}
              </p>
            </div>
            {live && (
              <span className="flex items-center gap-1.5 text-xs text-moss-300">
                <span className="w-2 h-2 rounded-full bg-moss-400 animate-pulse" />
                claude live
                {live.unread_bytes > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500/20 text-amber-400 px-1.5">
                    unread
                  </span>
                )}
              </span>
            )}
            <div className="flex gap-1.5 text-xs">
              <button
                onClick={() => onResume(project.id)}
                className="px-2 py-1 rounded border border-canopy-700 text-cream-300 hover:bg-canopy-800 transition-colors duration-300 ease-sloth"
              >
                {live ? "Attach" : "Resume"}
              </button>
              <button
                onClick={() => onDelete(project.id)}
                className="px-2 py-1 rounded border border-canopy-700 text-cream-500 hover:text-[var(--status-critical)] hover:border-[var(--status-critical)] transition-colors duration-300 ease-sloth"
              >
                Delete
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
