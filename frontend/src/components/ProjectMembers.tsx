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

  async function remove(userId: number) {
    setBusy(userId);
    await fetch(`/api/proxy/api/projects/${projectId}/members/${userId}/`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="panel rise" style={{ overflow: "hidden" }}>
      <div className="panel-head">
        <h2 style={{ fontSize: "1.02rem" }}>On this project</h2>
        <span className="eyebrow">{members.length} people</span>
      </div>

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
