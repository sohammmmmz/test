"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuthConfig, User } from "@/lib/types";

/**
 * The two things GitLab cannot tell us.
 *
 * Asked once, immediately after the first sign-in, because half a profile means
 * the app cannot decide what to show — an owner and a member see different
 * products.
 */
export function Onboarding({ user, config }: { user: User; config: AuthConfig }) {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch("/api/proxy/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, department, job_title: title }),
      });
      if (!res.ok) {
        setFailure("That did not save. Pick a role and a department, then try again.");
        return;
      }
      router.push(role === "owner" ? "/" : "/my-day");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="dawn" style={{ minHeight: "100vh", display: "grid", placeItems: "center",
                                    padding: 24 }}>
      <form onSubmit={save} className="stack gap-5" style={{ width: "100%", maxWidth: 460 }}>
        <div className="stack gap-2 rise">
          <span className="eyebrow">Welcome, {user.first_name || user.display_name}</span>
          <h1>Two questions, then you&rsquo;re in.</h1>
          <p className="soft" style={{ fontSize: ".93rem" }}>
            We have your GitLab account. What we don&rsquo;t know is how you work here.
          </p>
        </div>

        <fieldset className="stack gap-3 rise" style={{ border: 0, padding: 0, margin: 0,
                                                        animationDelay: "70ms" }}>
          <legend className="eyebrow" style={{ marginBottom: 8 }}>Which are you?</legend>
          {config.roles.map((option) => (
            <label
              key={option.value}
              className="panel row gap-3 center"
              style={{
                padding: "14px 16px",
                cursor: "pointer",
                borderColor: role === option.value ? "var(--brand)" : "var(--line)",
                background: role === option.value ? "var(--brand-wash)" : "var(--surface)",
              }}
            >
              <input
                type="radio" name="role" value={option.value}
                checked={role === option.value}
                onChange={(e) => setRole(e.target.value)}
                style={{ accentColor: "var(--brand)" }}
              />
              <span className="stack">
                <strong style={{ fontSize: ".92rem" }}>{option.label}</strong>
                <span className="faint" style={{ fontSize: ".79rem" }}>
                  {option.value === "owner"
                    ? "Create projects, build a team, run the morning meeting."
                    : "Work on projects and keep your own daily list."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid rise" style={{ gridTemplateColumns: "1fr 1fr", gap: 12,
                                            animationDelay: "120ms" }}>
          <label className="lbl">
            Department
            <select className="field" value={department} required
                    onChange={(e) => setDepartment(e.target.value)}>
              <option value="" disabled>Choose one</option>
              {config.departments.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className="lbl">
            Job title <span className="faint" style={{ fontWeight: 400 }}>— optional</span>
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Backend engineer" />
          </label>
        </div>

        {failure && (
          <p style={{ fontSize: ".84rem", color: "var(--overdue)" }}>{failure}</p>
        )}

        <button type="submit" className="btn btn-primary btn-lg rise"
                disabled={busy || !role || !department}
                style={{ alignSelf: "start", animationDelay: "170ms" }}>
          {busy && <span className="spin" />}
          {busy ? "Saving" : "Start using Morning Ledger"}
        </button>
      </form>
    </main>
  );
}
