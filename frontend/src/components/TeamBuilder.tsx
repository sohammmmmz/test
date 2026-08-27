"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "./Modal";

/**
 * Making a team.
 *
 * Only making one. Putting people on it lives on the team's own card, next to
 * the people already there — that is where an owner is looking when the thought
 * occurs, and it keeps this button to a single job.
 */
export function TeamBuilder({ hasTeams }: { hasTeams: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn btn-primary btn-lg" onClick={() => setOpen(true)}>
        {hasTeams ? "New team" : "Create a team"}
      </button>
    );
  }

  return (
    <Modal label="Create a team" onClose={() => setOpen(false)}>
      <div className="panel stack gap-4 rise"
           style={{ padding: 24, width: "100%", maxWidth: 460,
                    boxShadow: "var(--shadow-lg)" }}>
        <div className="row between center">
          <h2 style={{ fontSize: "1.25rem" }}>New team</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button>
        </div>

        {failure && <p style={{ fontSize: ".83rem", color: "var(--overdue)" }}>{failure}</p>}

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
          <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
              {busy && <span className="spin" />}
              Create team
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
