"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const onProject = new Set(members.map((m) => m.user.id));
  const available = teams
    .flatMap((t) => t.members.map((m) => m.user))
    .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i)
    .filter((u) => !onProject.has(u.id));

  async function add(userId: number) {
    setBusy(userId);
    setFailure(null);
    const res = await fetch(`/api/proxy/api/projects/${projectId}/members/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setFailure(data.detail ?? "That did not work.");
      return;
    }
    if (data.warnings?.length) setFailure(data.warnings.join(" "));
    router.refresh();
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
    router.refresh();
  }

  async function remove(userId: number) {
    setBusy(userId);
    await fetch(`/api/proxy/api/projects/${projectId}/members/${userId}/`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
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
          <span className="eyebrow">{members.length} people</span>
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
        {members.map((member) => (
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
              <button className="btn btn-ghost btn-sm" disabled={busy === member.user.id}
                      onClick={() => remove(member.user.id)}
                      aria-label={`Remove ${member.user.display_name}`}>
                Remove
              </button>
            )}
          </div>
        ))}

        {members.length === 0 && (
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
              <button key={person.id} className="btn btn-sm" disabled={busy === person.id}
                      onClick={() => add(person.id)}>
                {busy === person.id && <span className="spin" />}
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
