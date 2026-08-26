"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Team } from "@/lib/types";

/**
 * Creating a project creates a repository, so the form says so plainly. The
 * member picker matters more than it looks: everybody chosen here gets repo
 * access and a branch of their own in the same operation.
 */
export function CreateProject({ teams }: { teams: Team[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState<number | "">(teams[0]?.id ?? "");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const team = teams.find((t) => t.id === teamId);
  const candidates = team?.members.map((m) => m.user) ?? [];

  function toggle(id: number) {
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch("/api/proxy/api/projects/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          team: teamId || null,
          member_ids: picked,
          status: "active",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailure(data.detail ?? "The project could not be created.");
        return;
      }
      setOpen(false);
      router.push(`/projects/${data.id}`);
      router.refresh();
    } catch {
      setFailure("The server is not responding.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary btn-lg" onClick={() => setOpen(true)}>
        Create a project
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create a project"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(8, 13, 25, .55)",
        backdropFilter: "blur(3px)",
        display: "grid", placeItems: "center", padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <form
        onSubmit={submit}
        className="panel stack gap-4 rise"
        style={{ padding: 24, width: "100%", maxWidth: 520, maxHeight: "90vh",
                 overflowY: "auto", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="stack gap-1">
          <span className="eyebrow">New project</span>
          <h2>Create a project and its repository</h2>
          <p className="faint" style={{ fontSize: ".82rem" }}>
            The repository is created in your GitLab group, with a branch for each
            person you pick and a documentation branch for the BRD.
          </p>
        </div>

        <label className="lbl">
          Project name
          <input className="field" value={name} required autoFocus
                 onChange={(e) => setName(e.target.value)} placeholder="Apollo Checkout" />
        </label>

        <label className="lbl">
          What it is for
          <textarea className="field" value={description} rows={2}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Rebuild of the payment flow, targeting a 40% drop in cart abandonment." />
        </label>

        {teams.length > 0 && (
          <label className="lbl">
            Team
            <select className="field" value={teamId}
                    onChange={(e) => { setTeamId(Number(e.target.value)); setPicked([]); }}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}

        {candidates.length > 0 && (
          <div className="stack gap-2">
            <span style={{ fontSize: ".82rem", fontWeight: 500 }}>
              Who is working on it
              <span className="faint" style={{ fontWeight: 400 }}>
                {" "}— each gets repo access and a branch
              </span>
            </span>
            <div className="stack gap-1">
              {candidates.map((person) => (
                <label key={person.id} className="row gap-2 center"
                       style={{ padding: "7px 10px", borderRadius: 8, cursor: "pointer",
                                background: picked.includes(person.id)
                                  ? "var(--brand-wash)" : "transparent" }}>
                  <input type="checkbox" checked={picked.includes(person.id)}
                         onChange={() => toggle(person.id)}
                         style={{ accentColor: "var(--brand)" }} />
                  <span style={{ fontSize: ".86rem" }}>{person.display_name}</span>
                  <span className="mono faint grow" style={{ fontSize: ".72rem", textAlign: "right" }}>
                    dev/{person.gitlab_username || person.username}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {teams.length === 0 && (
          <p className="faint" style={{ fontSize: ".82rem" }}>
            You have no team yet, so the project starts with nobody on it. Build a
            team first if you want branches created at the same time.
          </p>
        )}

        {failure && (
          <p style={{ fontSize: ".83rem", color: "var(--overdue)" }}>{failure}</p>
        )}

        <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy && <span className="spin" />}
            {busy ? "Creating the repository" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
