"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch, type SessionInfo } from "@/lib/api";
import { ClaudeSessionDrawer } from "@/components/ClaudeSessionDrawer";

interface FileEntry {
  path: string;
  dir: boolean;
  size: number;
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerSession, setDrawerSession] = useState<string | null>(null);

  const { data: files = [] } = useQuery({
    queryKey: ["files", projectId],
    queryFn: () => apiFetch<FileEntry[]>(`/api/projects/${projectId}/files`),
  });

  const { data: file } = useQuery({
    queryKey: ["file", projectId, selected],
    queryFn: () =>
      apiFetch<{ path: string; content: string }>(
        `/api/projects/${projectId}/file?path=${encodeURIComponent(selected!)}`,
      ),
    enabled: !!selected,
    refetchInterval: false,
  });

  const chat = useMutation({
    mutationFn: () =>
      apiFetch<SessionInfo>(`/api/projects/${projectId}/session`, { method: "POST" }),
    onSuccess: (session) => setDrawerSession(session.id),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/workspace" className="text-cream-500 hover:text-cream-300 text-sm">
          ← workspace
        </Link>
        <h1 className="font-display text-2xl text-cream-100">{projectId}</h1>
        <button
          onClick={() => chat.mutate()}
          disabled={chat.isPending}
          className="ml-auto px-3 py-2 rounded-lg press-depth bg-moss-500/20 border border-moss-400/40 text-moss-300 text-sm hover:bg-moss-500/30 transition-colors duration-300 ease-sloth disabled:opacity-50"
        >
          {chat.isPending ? "Starting…" : "🦥 Chat with this Claude"}
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <nav className="rounded-xl border border-canopy-700 bg-canopy-900 p-3 max-h-[70vh] overflow-y-auto">
          {files.length === 0 && <p className="text-xs text-cream-500 p-2">No files yet.</p>}
          <ul className="space-y-0.5 text-sm font-mono">
            {files.map((f) => (
              <li key={f.path}>
                {f.dir ? (
                  <span className="block px-2 py-1 text-cream-500">📁 {f.path}/</span>
                ) : (
                  <button
                    onClick={() => setSelected(f.path)}
                    className={
                      selected === f.path
                        ? "block w-full text-left px-2 py-1 rounded bg-moss-500/15 text-moss-300"
                        : "block w-full text-left px-2 py-1 rounded text-cream-300 hover:bg-canopy-800"
                    }
                  >
                    {f.path}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="rounded-xl border border-canopy-700 bg-canopy-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-canopy-700 text-xs font-mono text-cream-500">
            {selected ?? "select a file — read-only in Phase 1, Monaco arrives in Phase 4"}
          </div>
          <pre className="term p-4 max-h-[65vh] overflow-auto text-cream-300">
            {file?.content ?? ""}
          </pre>
        </div>
      </div>

      {drawerSession && (
        <ClaudeSessionDrawer sessionId={drawerSession} onClose={() => setDrawerSession(null)} />
      )}
    </div>
  );
}
