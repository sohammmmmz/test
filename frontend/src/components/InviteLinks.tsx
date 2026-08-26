"use client";

import { useEffect, useState } from "react";
import { shortDate } from "@/lib/format";
import type { Team, TeamInvite } from "@/lib/types";

/**
 * Shareable links that join somebody to a team.
 *
 * This exists because adding people by hand cannot work for a new team: you
 * cannot add somebody who has never signed in, and they will not sign in
 * unless asked. The link asks, and carries the team through the GitLab
 * handshake so joining and signing up are one act.
 */
export function InviteLinks({ team }: { team: Team }) {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [limit, setLimit] = useState<"once" | "many">("many");
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/proxy/api/teams/${team.id}/invites/`);
      setInvites(res.ok ? await res.json() : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/api/teams/${team.id}/invites/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim(),
          max_uses: limit === "once" ? 1 : null,
          expires_in_days: 14,
        }),
      });
      if (res.ok) {
        const invite: TeamInvite = await res.json();
        setNote("");
        setInvites((current) => [invite, ...current]);
        copy(invite.url);
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/proxy/api/teams/${team.id}/invites/${token}/`, {
        method: "DELETE",
      });
      if (res.ok) setInvites(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked, usually because the page is not on a secure origin.
      // The link is on screen and selectable, so this is not a dead end.
    }
    setCopied(url);
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 2200);
  }

  const live = invites.filter((i) => i.is_usable);
  const spent = invites.filter((i) => !i.is_usable);

  return (
    <div className="panel stack" style={{ overflow: "hidden" }}>
      <div className="panel-head">
        <div className="stack">
          <h3 style={{ fontSize: "1rem" }}>Invite links</h3>
          <span className="faint" style={{ fontSize: ".77rem" }}>
            Whoever follows one signs in with GitLab and joins {team.name} as a member.
          </span>
        </div>
      </div>

      <div className="stack gap-3" style={{ padding: "14px 18px",
                                            borderBottom: "1px solid var(--line)" }}>
        <div className="row gap-2 wrap center">
          <input
            className="field grow"
            style={{ minWidth: 180 }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What this link is for — optional"
          />
          <div className="row" role="radiogroup" aria-label="How many people can use it">
            <button
              role="radio" aria-checked={limit === "many"}
              onClick={() => setLimit("many")}
              className="btn btn-sm"
              style={{
                borderRadius: "var(--radius) 0 0 var(--radius)", borderRightWidth: 0,
                ...(limit === "many"
                  ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}),
              }}
            >
              Anyone
            </button>
            <button
              role="radio" aria-checked={limit === "once"}
              onClick={() => setLimit("once")}
              className="btn btn-sm"
              style={{
                borderRadius: "0 var(--radius) var(--radius) 0",
                ...(limit === "once"
                  ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}),
              }}
            >
              One person
            </button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={create} disabled={busy}>
            {busy && <span className="spin" />}
            Create link
          </button>
        </div>
        <span className="faint" style={{ fontSize: ".74rem" }}>
          Links stop working after 14 days, and can be turned off at any time.
        </span>
      </div>

      <div className="stack">
        {loading && (
          <p className="faint" style={{ padding: "16px 18px", fontSize: ".85rem" }}>
            Loading links…
          </p>
        )}

        {!loading && invites.length === 0 && (
          <p className="faint" style={{ padding: "16px 18px", fontSize: ".85rem" }}>
            No links yet. Create one and it is copied to your clipboard.
          </p>
        )}

        {[...live, ...spent].map((invite) => (
          <div key={invite.id} className="stack gap-2"
               style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)",
                        opacity: invite.is_usable ? 1 : .55 }}>
            <div className="row between gap-3 center wrap">
              <span className="row gap-2 center">
                <span className={`pill ${invite.is_usable ? "pill-done" : ""}`}>
                  {invite.state}
                </span>
                {invite.note && (
                  <span style={{ fontSize: ".83rem" }}>{invite.note}</span>
                )}
                <span className="faint" style={{ fontSize: ".75rem" }}>
                  {invite.max_uses === 1 ? "single use" : "reusable"}
                  {invite.uses > 0 && ` · used ${invite.uses}×`}
                  {invite.expires_at && ` · until ${shortDate(invite.expires_at)}`}
                </span>
              </span>
              <span className="row gap-1">
                {invite.is_usable && (
                  <button className="btn btn-sm" onClick={() => copy(invite.url)}>
                    {copied === invite.url ? "Copied" : "Copy link"}
                  </button>
                )}
                {invite.is_usable && (
                  <button className="btn btn-ghost btn-sm" disabled={busy}
                          onClick={() => revoke(invite.token)}>
                    Turn off
                  </button>
                )}
              </span>
            </div>
            {invite.is_usable && (
              <code
                className="mono"
                style={{
                  fontSize: ".72rem", padding: "6px 9px", borderRadius: 6,
                  background: "var(--sunk)", color: "var(--ink-soft)",
                  overflowX: "auto", whiteSpace: "nowrap", display: "block",
                }}
              >
                {invite.url}
              </code>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
