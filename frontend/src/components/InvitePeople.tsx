"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Avatar } from "./ui";
import { shortDate } from "@/lib/format";
import type { Team, TeamInvite, User } from "@/lib/types";

/**
 * Getting somebody onto a team, both ways round.
 *
 * The two ways are not alternatives so much as two halves of the same problem.
 * Somebody already signed up can simply be added. Somebody who has never been
 * here cannot be — we cannot invent a GitLab identity for them, and they will
 * not turn up unless asked. The link is the asking, and it carries the team
 * through the GitLab handshake so signing up and joining are one act.
 *
 * Both live behind one quiet button because inviting is something an owner does
 * in the first week and rarely again; a permanent panel for it would outrank
 * the people it exists to gather.
 */
export function InvitePeople({ team }: { team: Team }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn btn-sm"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={`Invite people to ${team.name}`}
      >
        <PlusIcon />
        Invite
      </button>

      {open && (
        <Modal label={`Invite people to ${team.name}`}
               onClose={() => { setOpen(false); router.refresh(); }}>
          {/* React sends events from a portal up the component tree, not the DOM
              tree, so a click or a space bar inside this dialog would otherwise
              reach the card's expand handler. */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 520 }}
          >
            <InviteDialog team={team} onClose={() => { setOpen(false); router.refresh(); }} />
          </div>
        </Modal>
      )}
    </>
  );
}

function InviteDialog({ team, onClose }: { team: Team; onClose: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"people" | "link">("people");

  return (
    <div className="panel stack gap-4 rise"
         style={{ padding: 24, maxHeight: "88vh", overflowY: "auto",
                  boxShadow: "var(--shadow-lg)" }}>
      <div className="row between center gap-3">
        <div className="stack gap-1">
          <span className="eyebrow">Invite</span>
          <h2 style={{ fontSize: "1.25rem" }}>{team.name}</h2>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>

      <div className="row gap-1">
        <Tab active={tab === "people"} onClick={() => setTab("people")}>
          Someone already here
        </Tab>
        <Tab active={tab === "link"} onClick={() => setTab("link")}>
          Share a link
        </Tab>
      </div>

      {tab === "people"
        ? <AddFromPlatform team={team} onAdded={() => router.refresh()} />
        : <ShareLink team={team} />}
    </div>
  );
}

function Tab({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className="btn btn-sm" onClick={onClick} aria-pressed={active}
            style={active
              ? { background: "var(--brand-wash)", color: "var(--brand)",
                  borderColor: "transparent" }
              : undefined}>
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function AddFromPlatform({ team, onAdded }: { team: Team; onAdded: () => void }) {
  const [people, setPeople] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    const url = `/api/proxy/api/teams/directory/?available_for=${team.id}` +
                (query ? `&q=${encodeURIComponent(query)}` : "");
    const timer = setTimeout(() => {
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => { setPeople(rows); setLoading(false); })
        .catch(() => { setPeople([]); setLoading(false); });
    }, 180);
    return () => clearTimeout(timer);
  }, [team.id, query]);

  async function add(person: User) {
    setBusy(person.id);
    const res = await fetch(`/api/proxy/api/teams/${team.id}/members/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: person.id }),
    });
    setBusy(null);
    if (!res.ok) return;
    setPeople((current) => current.filter((p) => p.id !== person.id));
    setAdded((current) => [...current, person.display_name]);
    onAdded();
  }

  return (
    <div className="stack gap-3">
      <input className="field" value={query} autoFocus
             onChange={(e) => setQuery(e.target.value)}
             placeholder="Search everyone signed up to the platform" />

      {added.length > 0 && (
        <p className="fade" style={{ fontSize: ".8rem", color: "var(--done)" }}>
          {added.join(", ")} {added.length === 1 ? "is" : "are"} on {team.name}.
        </p>
      )}

      <div className="stack gap-1" style={{ minHeight: 180, maxHeight: 300, overflowY: "auto" }}>
        {loading && [0, 1, 2].map((i) => (
          <div key={i} className="row gap-3 center" style={{ padding: "8px 4px" }}>
            <span className="bone" style={{ width: 32, height: 32, borderRadius: 999 }} />
            <span className="stack gap-1 grow">
              <span className="bone" style={{ width: "42%", height: 9 }} />
              <span className="bone" style={{ width: "26%", height: 8 }} />
            </span>
          </div>
        ))}

        {!loading && people.map((person, index) => (
          <div key={person.id} className="row gap-3 center rise"
               style={{ padding: "8px 10px", borderRadius: 8,
                        animationDelay: `${index * 30}ms` }}>
            <Avatar name={person.display_name} url={person.gitlab_avatar_url || undefined} />
            <span className="stack grow">
              <span style={{ fontSize: ".87rem", fontWeight: 500 }}>{person.display_name}</span>
              <span className="faint" style={{ fontSize: ".74rem" }}>
                {person.job_title || person.department}
                {person.role === "owner" && " · owner"}
              </span>
            </span>
            <button className="btn btn-sm" disabled={busy === person.id}
                    onClick={() => add(person)}>
              {busy === person.id && <span className="spin" />}
              Add
            </button>
          </div>
        ))}

        {!loading && people.length === 0 && (
          <p className="faint" style={{ fontSize: ".84rem", padding: "18px 4px" }}>
            {query
              ? "Nobody signed up matches that. Share a link instead — they can join and sign up in one go."
              : "Everyone signed up is already on this team. Share a link to bring somebody new in."}
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ShareLink({ team }: { team: Team }) {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [limit, setLimit] = useState<"once" | "many">("many");
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch(`/api/proxy/api/teams/${team.id}/invites/`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { setInvites(rows); setLoading(false); })
      .catch(() => { setInvites([]); setLoading(false); });
  }, [team.id]);

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

  async function turnOff(token: string) {
    setBusy(true);
    // Gone from the list immediately — the server deletes it outright, so
    // waiting for the round trip only makes the click feel unheard.
    setInvites((current) => current.filter((i) => i.token !== token));
    try {
      const res = await fetch(`/api/proxy/api/teams/${team.id}/invites/${token}/`, {
        method: "DELETE",
      });
      if (res.ok) setInvites(await res.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-3">
      <p className="soft" style={{ fontSize: ".85rem" }}>
        Whoever follows the link signs in with GitLab and lands on {team.name} as a
        member. Links stop working after 14 days.
      </p>

      <div className="row gap-2 wrap center">
        <input className="field grow" style={{ minWidth: 170 }} value={note}
               onChange={(e) => setNote(e.target.value)}
               placeholder="What this link is for — optional" />
        <div className="row" role="radiogroup" aria-label="How many people can use it">
          <button role="radio" aria-checked={limit === "many"} className="btn btn-sm"
                  onClick={() => setLimit("many")}
                  style={{ borderRadius: "var(--radius) 0 0 var(--radius)", borderRightWidth: 0,
                           ...(limit === "many"
                             ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}) }}>
            Anyone
          </button>
          <button role="radio" aria-checked={limit === "once"} className="btn btn-sm"
                  onClick={() => setLimit("once")}
                  style={{ borderRadius: "0 var(--radius) var(--radius) 0",
                           ...(limit === "once"
                             ? { background: "var(--brand-wash)", color: "var(--brand)" } : {}) }}>
            One person
          </button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={create} disabled={busy}>
          {busy && <span className="spin" />}
          Create link
        </button>
      </div>

      <div className="stack gap-2" style={{ minHeight: 90 }}>
        {loading && <span className="bone" style={{ height: 46, borderRadius: 8 }} />}

        {!loading && invites.length === 0 && (
          <p className="faint" style={{ fontSize: ".83rem", padding: "10px 0" }}>
            No links yet. Create one and it is copied to your clipboard.
          </p>
        )}

        {invites.map((invite) => (
          <div key={invite.id} className="stack gap-2 rise"
               style={{ padding: "11px 13px", borderRadius: "var(--radius)",
                        border: "1px solid var(--line)",
                        opacity: invite.is_usable ? 1 : .5 }}>
            <div className="row between gap-3 center wrap">
              <span className="row gap-2 center wrap">
                {!invite.is_usable && <span className="pill">{invite.state}</span>}
                {invite.note && <span style={{ fontSize: ".83rem" }}>{invite.note}</span>}
                <span className="faint" style={{ fontSize: ".74rem" }}>
                  {invite.max_uses === 1 ? "single use" : "reusable"}
                  {invite.uses > 0 && ` · used ${invite.uses}×`}
                  {invite.expires_at && ` · until ${shortDate(invite.expires_at)}`}
                </span>
              </span>
              <span className="row gap-1">
                {invite.is_usable && (
                  <button className="btn btn-sm" onClick={() => copy(invite.url)}>
                    {copied === invite.url ? "Copied" : "Copy"}
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => turnOff(invite.token)}>
                  {invite.is_usable ? "Turn off" : "Remove"}
                </button>
              </span>
            </div>
            {invite.is_usable && (
              <code className="mono"
                    style={{ fontSize: ".71rem", padding: "6px 9px", borderRadius: 6,
                             background: "var(--sunk)", color: "var(--ink-soft)",
                             overflowX: "auto", whiteSpace: "nowrap", display: "block" }}>
                {invite.url}
              </code>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
