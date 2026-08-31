"use client";

import { useEffect, useMemo, useState } from "react";
import { useActivity } from "./Activity";
import { Avatar } from "./ui";
import type { ProjectMember, Team } from "@/lib/types";

/**
 * Who is on the project, and the branch cut for each of them.
 *
 * The branch is shown because it is the thing a developer actually needs — the
 * name to check out — and because a member whose branch failed to create needs
 * to know before they go looking for it.
 */
export function ProjectMembers({ projectId, members, teams, canEdit }: {
  projectId: number;
  members: ProjectMember[];
  teams: Team[];
  canEdit: boolean;
}) {
  const { run, refreshSoon, inFlight } = useActivity();
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Rows added or dropped here but not yet confirmed.
   *
   * Adding somebody to a project is three things upstream — the membership, the
   * repository access, and a branch cut for them — so it is among the slowest
   * writes in the app and the most worth showing immediately. Cleared when a
   * fresh `members` prop arrives.
   */
  const [pendingAdds, setPendingAdds] = useState<ProjectMember[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<number[]>([]);
  useEffect(() => { setPendingAdds([]); setPendingRemovals([]); }, [members]);

  const shown = useMemo(
    () => [...members.filter((m) => !pendingRemovals.includes(m.user.id)), ...pendingAdds],
    [members, pendingAdds, pendingRemovals],
  );

  const onProject = new Set(shown.map((m) => m.user.id));
  const available = teams
    .flatMap((t) => t.members.map((m) => m.user))
    .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i)
    .filter((u) => !onProject.has(u.id));

  function add(userId: number) {
    const person = available.find((u) => u.id === userId);
    if (!person) return;
    setFailure(null);
    setPendingAdds((all) => [...all, {
      user: person, branch_name: "", role: "member",
    } as unknown as ProjectMember]);

    run({
      key: `project:${projectId}:member:${userId}:add`,
      pending: `Adding ${person.display_name}`,
      done: `${person.display_name} is on the project`,
      failed: `Could not add ${person.display_name} to this project`,
      method: "POST",
      path: `/api/projects/${projectId}/members/`,
      body: { user_id: userId },
      targetUrl: `/projects/${projectId}`,
      // The write can succeed and still have something to say — most often that
      // the person is on the repository but their branch could not be cut.
      onSuccess: (data) => {
        const warnings = (data as { warnings?: string[] } | null)?.warnings;
        if (warnings?.length) setFailure(warnings.join(" "));
      },
    });
  }

  /**
   * Pull the repository's own members onto the project.
   *
   * Adding somebody here already puts them on the repository; this is the
   * other direction, for when GitLab is where access was actually granted — a
   * repository linked from outside, or somebody added in GitLab's own UI.
   */
  async function importFromRepo() {
    setImporting(true);
    setFailure(null);
    setNote(null);

    const res = await fetch(`/api/proxy/api/projects/${projectId}/sync-members/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    setImporting(false);

    if (!res.ok) {
      setFailure(data.detail ?? "The repository's members could not be read.");
      return;
    }

    const report = data.imported ?? {};
    const added: string[] = report.added ?? [];
    const unknown: { username: string }[] = report.unknown ?? [];
    const lines: string[] = [];

    lines.push(
      added.length
        ? `Added ${added.join(", ")}.`
        : "Everyone on the repository is already on this project.",
    );
    if (unknown.length) {
      lines.push(
        `${unknown.length} on the repository ${unknown.length === 1 ? "has" : "have"} ` +
        `not signed in here (${unknown.map((u) => u.username).filter(Boolean).join(", ")}) — ` +
        "send them an invite link and they will appear.",
      );
    }
    if (report.warnings?.length) lines.push(report.warnings.join(" "));

    setNote(lines.join(" "));
    refreshSoon();
  }

  function remove(userId: number) {
    const person = shown.find((m) => m.user.id === userId)?.user;
    setPendingRemovals((all) => [...all, userId]);
    run({
      key: `project:${projectId}:member:${userId}:remove`,
      pending: "Removing",
      done: person ? `Removed ${person.display_name}` : "Removed",
      failed: person
        ? `Could not remove ${person.display_name} from this project`
        : "Could not remove that person",
      method: "DELETE",
      path: `/api/projects/${projectId}/members/${userId}/`,
      targetUrl: `/projects/${projectId}`,
    });
  }

  return (
    <div className="panel rise" style={{ overflow: "hidden" }}>
      <div className="panel-head">
        <div className="stack">
          <h2 style={{ fontSize: "1.02rem" }}>On this project</h2>
          <span className="faint" style={{ fontSize: ".76rem" }}>
            Everyone here has repository access and a branch of their own.
          </span>
        </div>
        <span className="row gap-2 center">
          {canEdit && (
            <button className="btn btn-sm" onClick={importFromRepo} disabled={importing}
                    title="Pull in whoever is already on the GitLab repository">
              {importing && <span className="spin" />}
              Import from repository
            </button>
          )}
          <span className="eyebrow">{shown.length} people</span>
        </span>
      </div>

      {note && (
        <p className="fade" style={{ padding: "10px 18px", fontSize: ".81rem",
                    color: "var(--brand)", background: "var(--brand-wash)" }}>
          {note}
        </p>
      )}

      {failure && (
        <p style={{ padding: "10px 18px", fontSize: ".81rem", color: "var(--attention)",
                    background: "var(--attention-wash)" }}>
          {failure}
        </p>
      )}

      <div className="stack">
        {shown.map((member) => (
          <div key={member.id} className="row gap-3 center"
               style={{ padding: "11px 18px", borderBottom: "1px solid var(--line)" }}>
            <Avatar name={member.user.display_name}
                    url={member.user.gitlab_avatar_url || undefined} />
            <span className="stack grow">
              <span style={{ fontSize: ".87rem", fontWeight: 500 }}>
                {member.user.display_name}
              </span>
              <span className="mono faint" style={{ fontSize: ".72rem" }}>
                {member.branch_name}
              </span>
            </span>
            {!member.synced_to_gitlab && (
              <span className="pill pill-attention" title={member.sync_error}>
                branch pending
              </span>
            )}
            {canEdit && (
              <button className="btn btn-ghost btn-sm"
                      disabled={inFlight.has(`project:${projectId}:member:${member.user.id}:remove`)}
                      onClick={() => remove(member.user.id)}
                      aria-label={`Remove ${member.user.display_name}`}>
                Remove
              </button>
            )}
          </div>
        ))}

        {shown.length === 0 && (
          <p className="faint" style={{ padding: "18px", fontSize: ".85rem" }}>
            Nobody is on this project yet.
          </p>
        )}
      </div>

      {canEdit && available.length > 0 && (
        <div className="stack gap-2" style={{ padding: "13px 18px",
                                              borderTop: "1px solid var(--line)" }}>
          <span className="eyebrow">Add from your team</span>
          <div className="row gap-2 wrap">
            {available.map((person) => (
              <button key={person.id} className="btn btn-sm"
                      disabled={inFlight.has(`project:${projectId}:member:${person.id}:add`)}
                      onClick={() => add(person.id)}>
                {person.display_name}
              </button>
            ))}
          </div>
          <span className="faint" style={{ fontSize: ".74rem" }}>
            Adding someone gives them repository access and creates their branch.
          </span>
        </div>
      )}
    </div>
  );
}
