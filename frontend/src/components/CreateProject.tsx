"use client";

import { Modal } from "./Modal";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RepoPicker } from "./RepoPicker";
import type { AvailableRepo, RepoBranch, Team } from "@/lib/types";

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

  // Link an existing repository, or create a fresh one.
  const [source, setSource] = useState<"new" | "existing">("new");
  const [repo, setRepo] = useState<AvailableRepo | null>(null);
  const [branches, setBranches] = useState<RepoBranch[]>([]);
  const [docsBranch, setDocsBranch] = useState("");
  const [newBranch, setNewBranch] = useState(true);

  // A linked repository may already keep its docs somewhere, so offer what is
  // there before offering to make another branch beside it.
  useEffect(() => {
    if (!repo) {
      setBranches([]);
      setDocsBranch("");
      setNewBranch(true);
      return;
    }
    let live = true;
    fetch(`/api/proxy/api/projects/repo-branches/?repo=${repo.gitlab_project_id}`)
      .then((r) => (r.ok ? r.json() : { branches: [] }))
      .then((data) => {
        if (!live) return;
        const rows: RepoBranch[] = data.branches ?? [];
        setBranches(rows);
        const existing = rows.find((b) => b.name === (data.default ?? "documentation"));
        if (existing) {
          setNewBranch(false);
          setDocsBranch(existing.name);
        } else {
          setNewBranch(true);
          setDocsBranch(data.default ?? "documentation");
        }
      })
      .catch(() => live && setBranches([]));
    return () => { live = false; };
  }, [repo]);

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
          repo_reference:
            source === "existing" && repo ? String(repo.gitlab_project_id) : null,
          documentation_branch: docsBranch.trim() || null,
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
    <Modal label="Create a project" onClose={() => setOpen(false)}>
      <form
        onSubmit={submit}
        className="panel stack gap-4 rise"
        style={{ padding: 24, width: "100%", maxWidth: 520, maxHeight: "90vh",
                 overflowY: "auto", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="stack gap-1">
          <span className="eyebrow">New project</span>
          <h2>
            {source === "existing"
              ? "Create a project on a repository you have"
              : "Create a project and its repository"}
          </h2>
          <p className="faint" style={{ fontSize: ".82rem" }}>
            {source === "existing"
              ? "The repository is left as it is. Everyone you pick gets access and a branch of their own."
              : "The repository is created in your GitLab group, with a branch for each person you pick and a documentation branch for the BRD."}
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

        <div className="stack gap-2">
          <span style={{ fontSize: ".82rem", fontWeight: 500 }}>Repository</span>
          <div className="row" role="radiogroup" aria-label="Which repository">
            <button
              type="button" role="radio" aria-checked={source === "new"}
              onClick={() => { setSource("new"); setRepo(null); }}
              className="btn btn-sm"
              style={{
                borderRadius: "var(--radius) 0 0 var(--radius)", borderRightWidth: 0,
                ...(source === "new"
                  ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}),
              }}
            >
              Create a new one
            </button>
            <button
              type="button" role="radio" aria-checked={source === "existing"}
              onClick={() => setSource("existing")}
              className="btn btn-sm"
              style={{
                borderRadius: "0 var(--radius) var(--radius) 0",
                ...(source === "existing"
                  ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}),
              }}
            >
              Use one I have
            </button>
          </div>

          {source === "existing" ? (
            <RepoPicker value={repo} onPick={setRepo} />
          ) : (
            <p className="faint" style={{ fontSize: ".78rem" }}>
              Created in your GitLab group, initialised so the member branches
              have something to branch from.
            </p>
          )}
        </div>

        <div className="stack gap-2">
          <span style={{ fontSize: ".82rem", fontWeight: 500 }}>
            Documentation branch
            <span className="faint" style={{ fontWeight: 400 }}>
              {" "}— where the BRD and technical doc are committed
            </span>
          </span>

          {source === "existing" && branches.length > 0 && (
            <div className="row" role="radiogroup" aria-label="Documentation branch source">
              <button
                type="button" role="radio" aria-checked={!newBranch}
                onClick={() => { setNewBranch(false); setDocsBranch(branches[0]?.name ?? ""); }}
                className="btn btn-sm"
                style={{
                  borderRadius: "var(--radius) 0 0 var(--radius)", borderRightWidth: 0,
                  ...(!newBranch
                    ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}),
                }}
              >
                Use an existing branch
              </button>
              <button
                type="button" role="radio" aria-checked={newBranch}
                onClick={() => { setNewBranch(true); setDocsBranch("documentation"); }}
                className="btn btn-sm"
                style={{
                  borderRadius: "0 var(--radius) var(--radius) 0",
                  ...(newBranch
                    ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}),
                }}
              >
                Make a new one
              </button>
            </div>
          )}

          {source === "existing" && branches.length > 0 && !newBranch ? (
            <select className="field" value={docsBranch}
                    onChange={(e) => setDocsBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}{b.is_default ? " — default" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="field"
              value={docsBranch}
              onChange={(e) => setDocsBranch(e.target.value)}
              placeholder="documentation"
            />
          )}
          <span className="faint" style={{ fontSize: ".74rem" }}>
            Left blank, it uses <code className="mono">documentation</code>. An
            existing branch is used as it stands — nothing is rearranged.
          </span>
        </div>

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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !name.trim() || (source === "existing" && !repo)}
          >
            {busy && <span className="spin" />}
            {busy
              ? (source === "existing" ? "Linking the repository" : "Creating the repository")
              : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
