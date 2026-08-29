"use client";

import { useState } from "react";
import { Modal } from "./Modal";

/**
 * Removing a project, and — only if asked twice — its repository.
 *
 * The two are deliberately different acts. Stopping tracking a project here is
 * routine and reversible in spirit: the code is untouched and can be linked
 * again tomorrow. Deleting the repository is neither, so it asks for the
 * project's name typed back. The backend checks that typing too, because a
 * confirmation that only exists in the browser is not a confirmation.
 */
export function DeleteProject({ projectId, projectName, repoPath }: {
  projectId: number;
  projectName: string;
  repoPath: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [alsoRepo, setAlsoRepo] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nameMatches = typed.trim() === projectName;
  const blocked = busy || (alsoRepo && !nameMatches);

  function close() {
    // Dismissing after a successful delete would leave the reader looking at a
    // project that no longer exists.
    if (deleted) {
      leave();
      return;
    }
    setOpen(false);
    setAlsoRepo(false);
    setTyped("");
    setFailure(null);
  }

  /**
   * Leave the page whose project no longer exists.
   *
   * A whole-page navigation, deliberately, not router.replace(). The route we
   * are standing on is /projects/[id], and the moment the delete succeeds its
   * server render 404s. Soft-navigating away while the App Router still holds
   * that route hands React a transition that cannot resolve: the spinner spins
   * for ever and every other link stops working until the tab is reloaded.
   * There is nothing here worth preserving across the move, so the blunt
   * instrument is also the correct one.
   */
  function leave() {
    window.location.assign("/projects");
  }

  async function remove() {
    setBusy(true);
    setFailure(null);

    const query = new URLSearchParams();
    if (alsoRepo) {
      query.set("delete_repository", "true");
      query.set("confirm", typed.trim());
    }
    const suffix = query.toString() ? `?${query}` : "";

    let res: Response;
    try {
      res = await fetch(`/api/proxy/api/projects/${projectId}/${suffix}`, {
        method: "DELETE",
        // Deleting a repository goes out to GitLab, which retries a failing
        // call before giving up. Without a ceiling the button can sit spinning
        // for two minutes with nothing to say for itself.
        signal: AbortSignal.timeout(150_000),
      });
    } catch (err) {
      setBusy(false);
      setFailure(
        (err as Error)?.name === "TimeoutError"
          ? "GitLab did not answer in time. Reload the page — the project may already be gone."
          : "The request could not be sent. Check that the backend is running.",
      );
      return;
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      setBusy(false);
      setFailure(body?.detail ?? "That project could not be deleted.");
      return;
    }

    // GitLab may have refused the repository even though the project went. The
    // project is gone either way, so this is a warning to read on the way out,
    // not a failure to stay here for.
    if (body?.repository_error) {
      setBusy(false);
      setDeleted(true);
      setFailure(
        `The project is gone, but GitLab kept the repository: ${body.repository_error}`,
      );
      return;
    }

    leave();
  }

  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}
              style={{ color: "var(--ink-faint)" }}>
        Delete project
      </button>
    );
  }

  return (
    <Modal label={`Delete ${projectName}`} onClose={close}>
      <div className="panel stack gap-4 rise"
           style={{ padding: 24, width: "100%", maxWidth: 470,
                    boxShadow: "var(--shadow-lg)" }}>

        <div className="stack gap-2">
          <span className="eyebrow" style={{ color: "var(--overdue)" }}>Delete</span>
          <h2 style={{ fontSize: "1.3rem" }}>{projectName}</h2>
          <p className="soft" style={{ fontSize: ".87rem" }}>
            Milestones, tasks, members and uploaded documents tracked here are removed.
            Whatever is already in GitLab — issues, branches, commits — stays exactly
            as it is.
          </p>
        </div>

        <label className="row gap-3"
               style={{ alignItems: "flex-start", padding: "13px 14px",
                        border: `1px solid ${alsoRepo ? "var(--overdue)" : "var(--line)"}`,
                        borderRadius: "var(--radius)", cursor: "pointer",
                        background: alsoRepo ? "var(--overdue-wash)" : "transparent",
                        transition: "all .25s var(--ease)" }}>
          <input type="checkbox" checked={alsoRepo} style={{ marginTop: 3 }}
                 onChange={(e) => { setAlsoRepo(e.target.checked); setTyped(""); }} />
          <span className="stack gap-1">
            <strong style={{ fontSize: ".87rem" }}>Delete the GitLab repository too</strong>
            <span className="faint" style={{ fontSize: ".79rem" }}>
              {repoPath
                ? <>Every branch and commit in <span className="mono">{repoPath}</span> goes with it. This cannot be undone.</>
                : "There is no repository linked to this project."}
            </span>
          </span>
        </label>

        {alsoRepo && (
          <label className="lbl fade">
            Type <strong>{projectName}</strong> to confirm
            <input className="field" value={typed} autoFocus autoComplete="off"
                   onChange={(e) => setTyped(e.target.value)}
                   placeholder={projectName}
                   style={nameMatches ? { borderColor: "var(--overdue)" } : undefined} />
          </label>
        )}

        {failure && (
          <p style={{ fontSize: ".83rem", color: "var(--overdue)" }}>{failure}</p>
        )}

        <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
          {deleted ? (
            <button className="btn btn-primary btn-sm" onClick={leave}>
              Go to projects
            </button>
          ) : (
            <>
              <button className="btn btn-sm" onClick={close} disabled={busy}>Keep it</button>
              <button className="btn btn-danger btn-sm" onClick={remove} disabled={blocked}>
                {busy && <span className="spin" />}
                {alsoRepo ? "Delete project and repository" : "Delete project"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
