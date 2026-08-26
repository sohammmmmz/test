"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "./ui";
import type { Team, User } from "@/lib/types";

/**
 * Making a team, and putting people on it.
 *
 * Only people who have already signed up can be added: a teammate exists here
 * because they have a GitLab account, and without one they could never be
 * assigned a task.
 */
export function TeamBuilder({ teams }: { teams: Team[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"add" | "create">(teams.length ? "add" : "create");
  const [teamId, setTeamId] = useState<number | "">(teams[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open || mode !== "add" || !teamId) return;
    const url = `/api/proxy/api/teams/directory/?available_for=${teamId}` +
                (query ? `&q=${encodeURIComponent(query)}` : "");
    const timer = setTimeout(() => {
      fetch(url).then((r) => (r.ok ? r.json() : [])).then(setPeople).catch(() => setPeople([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [open, mode, teamId, query]);

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const res = await fetch("/api/proxy/api/teams/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setFailure("That team could not be created. You may already have one by that name.");
      return;
    }
    setName("");
    setDescription("");
    setMode("add");
    router.refresh();
  }

  async function addPerson(userId: number) {
    setBusy(true);
    await fetch(`/api/proxy/api/teams/${teamId}/members/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    setBusy(false);
    setPeople((current) => current.filter((p) => p.id !== userId));
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn btn-primary btn-lg" onClick={() => setOpen(true)}>
        {teams.length ? "Manage team" : "Create a team"}
      </button>
    );
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Manage team"
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(8,13,25,.55)",
               backdropFilter: "blur(3px)", display: "grid", placeItems: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="panel stack gap-4 rise"
           style={{ padding: 24, width: "100%", maxWidth: 520, maxHeight: "88vh",
                    overflowY: "auto", boxShadow: "var(--shadow-lg)" }}>

        <div className="row between center">
          <h2>Your team</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button>
        </div>

        <div className="row gap-1">
          {teams.length > 0 && (
            <button className="btn btn-sm" onClick={() => setMode("add")}
                    style={mode === "add"
                      ? { background: "var(--brand-wash)", color: "var(--brand)",
                          borderColor: "transparent" } : undefined}>
              Add people
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setMode("create")}
                  style={mode === "create"
                    ? { background: "var(--brand-wash)", color: "var(--brand)",
                        borderColor: "transparent" } : undefined}>
            New team
          </button>
        </div>

        {failure && <p style={{ fontSize: ".83rem", color: "var(--overdue)" }}>{failure}</p>}

        {mode === "create" ? (
          <form onSubmit={createTeam} className="stack gap-3">
            <label className="lbl">
              Team name
              <input className="field" value={name} required autoFocus
                     onChange={(e) => setName(e.target.value)} placeholder="Platform" />
            </label>
            <label className="lbl">
              What they work on
              <input className="field" value={description}
                     onChange={(e) => setDescription(e.target.value)}
                     placeholder="Checkout, analytics and the migration" />
            </label>
            <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}
                    style={{ alignSelf: "start" }}>
              {busy && <span className="spin" />}
              Create team
            </button>
          </form>
        ) : (
          <div className="stack gap-3">
            {teams.length > 1 && (
              <label className="lbl">
                Team
                <select className="field" value={teamId}
                        onChange={(e) => setTeamId(Number(e.target.value))}>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}

            <input className="field" value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search everyone who has signed up" />

            <div className="stack gap-1" style={{ maxHeight: 280, overflowY: "auto" }}>
              {people.map((person) => (
                <div key={person.id} className="row gap-3 center"
                     style={{ padding: "8px 10px", borderRadius: 8 }}>
                  <Avatar name={person.display_name}
                          url={person.gitlab_avatar_url || undefined} />
                  <span className="stack grow">
                    <span style={{ fontSize: ".87rem", fontWeight: 500 }}>
                      {person.display_name}
                    </span>
                    <span className="faint" style={{ fontSize: ".74rem" }}>
                      {person.job_title || person.department}
                      {person.role === "owner" && " · owner"}
                    </span>
                  </span>
                  <button className="btn btn-sm" disabled={busy}
                          onClick={() => addPerson(person.id)}>
                    Add
                  </button>
                </div>
              ))}
              {people.length === 0 && (
                <p className="faint" style={{ fontSize: ".84rem", padding: "14px 4px" }}>
                  {query
                    ? "Nobody matches that."
                    : "Everyone who has signed up is already on this team."}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
