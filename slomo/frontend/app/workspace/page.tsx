"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Project, type SessionInfo } from "@/lib/api";
import { ProjectTree } from "@/components/ProjectTree";
import { ClaudeSessionDrawer } from "@/components/ClaudeSessionDrawer";

const TEMPLATES = ["blank", "python", "node", "fastapi", "react"] as const;

export default function WorkspacePage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState<(typeof TEMPLATES)[number]>("python");
  const [drawerSession, setDrawerSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiFetch<Project[]>("/api/projects"),
  });
  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiFetch<SessionInfo[]>("/api/sessions"),
    refetchInterval: 3000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };

  const createProject = useMutation({
    mutationFn: () =>
      apiFetch<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: newName, template: newTemplate }),
      }),
    onSuccess: async (project) => {
      setShowNew(false);
      setNewName("");
      // BRD: new project auto-spawns its Claude session
      const session = await apiFetch<SessionInfo>(`/api/projects/${project.id}/session`, {
        method: "POST",
      });
      setDrawerSession(session.id);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const resume = useMutation({
    mutationFn: (projectId: string) =>
      apiFetch<SessionInfo>(`/api/projects/${projectId}/session`, { method: "POST" }),
    onSuccess: (session) => {
      setDrawerSession(session.id);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (projectId: string) =>
      apiFetch<void>(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const kill = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<void>(`/api/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl text-cream-100">Workspace</h1>
          <button
            onClick={() => setShowNew(true)}
            className="px-3 py-2 rounded-lg bg-moss-500/20 border border-moss-400/40 text-moss-300 text-sm hover:bg-moss-500/30 transition-colors duration-300 ease-sloth"
          >
            + New project
          </button>
        </div>
        {error && (
          <p className="text-xs rounded-lg border border-dashed px-3 py-2"
            style={{ borderColor: "var(--status-serious)", color: "var(--status-serious)" }}>
            {error} <button className="underline ml-1" onClick={() => setError(null)}>dismiss</button>
          </p>
        )}
        <ProjectTree
          projects={projects}
          sessions={sessions}
          onResume={(id) => resume.mutate(id)}
          onDelete={(id) => {
            if (window.confirm(`Delete project "${id}" and all its files?`)) remove.mutate(id);
          }}
        />
      </section>

      <aside className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-cream-500">Claude sessions</h2>
        {sessions.length === 0 && (
          <p className="text-sm text-cream-500">No sessions yet. Resume a project to spawn one.</p>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="rounded-xl border border-canopy-700 bg-canopy-900 p-3 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: s.status === "running" ? "var(--status-good)" : "var(--axis-baseline)",
                }}
              />
              <span className="font-mono text-cream-100 truncate">{s.project_id}</span>
              <span className="ml-auto text-xs text-cream-500">{s.status}</span>
            </div>
            <div className="text-xs text-cream-500 font-mono">
              pid {s.pid ?? "—"} · {s.unread_bytes > 0 ? `${s.unread_bytes} B unread` : "read"}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setDrawerSession(s.id)}
                className="px-2 py-1 rounded border border-canopy-700 text-xs text-cream-300 hover:bg-canopy-800"
              >
                Open
              </button>
              {s.status === "running" && (
                <button
                  onClick={() => kill.mutate(s.id)}
                  className="px-2 py-1 rounded border border-canopy-700 text-xs text-cream-500 hover:text-[var(--status-critical)] hover:border-[var(--status-critical)]"
                >
                  Kill
                </button>
              )}
            </div>
          </div>
        ))}
      </aside>

      {showNew && (
        <div className="fixed inset-0 z-40 bg-bark-950/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-canopy-700 bg-bark-900 p-5 space-y-4">
            <h2 className="font-display text-lg text-cream-100">New project</h2>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className="w-full rounded-lg bg-canopy-900 border border-canopy-700 px-3 py-2 text-sm text-cream-100 placeholder:text-cream-700 focus:outline-none focus:border-moss-400"
            />
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t}
                  onClick={() => setNewTemplate(t)}
                  className={
                    t === newTemplate
                      ? "px-2.5 py-1 rounded-full text-xs bg-moss-500/25 border border-moss-400/50 text-moss-300"
                      : "px-2.5 py-1 rounded-full text-xs border border-canopy-700 text-cream-500 hover:text-cream-300"
                  }
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 text-sm">
              <button onClick={() => setShowNew(false)}
                className="px-3 py-2 rounded-lg border border-canopy-700 text-cream-300 hover:bg-canopy-800">
                Cancel
              </button>
              <button
                onClick={() => newName.trim() && createProject.mutate()}
                disabled={!newName.trim() || createProject.isPending}
                className="px-3 py-2 rounded-lg bg-moss-500/20 border border-moss-400/40 text-moss-300 hover:bg-moss-500/30 disabled:opacity-50"
              >
                {createProject.isPending ? "Creating…" : "Create + start Claude"}
              </button>
            </div>
          </div>
        </div>
      )}

      {drawerSession && (
        <ClaudeSessionDrawer sessionId={drawerSession} onClose={() => setDrawerSession(null)} />
      )}
    </div>
  );
}
