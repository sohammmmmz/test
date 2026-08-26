"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuthConfig } from "@/lib/types";

/**
 * The way in.
 *
 * GitLab is the real door — it is the only thing that can give somebody the
 * account id every assignment depends on. Demo mode opens a second door so the
 * product can be walked through before an OAuth application exists, and says
 * plainly that it is not connected to anything.
 */
export function SignIn({ config, error, next }: {
  config: AuthConfig | null;
  error: string | null;
  next: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [role, setRole] = useState("owner");
  const [department, setDepartment] = useState("engineering");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const oauthReady = config?.oauth_configured ?? false;
  const demoReady = config?.demo_mode ?? false;

  async function demoSignIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch("/api/proxy/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, department, job_title: title }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFailure(data.detail ?? "That sign-in did not work.");
        return;
      }
      router.push(role === "owner" ? "/" : "/my-day");
      router.refresh();
    } catch {
      setFailure("The server is not responding. Check that Django is running on port 8000.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="dawn" style={{ minHeight: "100vh", display: "grid", placeItems: "center",
                                    padding: 24 }}>
      <div className="stack gap-6" style={{ width: "100%", maxWidth: 440 }}>

        <div className="stack gap-3 rise">
          <div className="row gap-2 center">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="15" r="5.2" fill="var(--brand)" opacity=".9" />
              <path d="M2 17.4h20" stroke="var(--ink)" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M12 4.4v2.2M5.6 6.6l1.5 1.6M18.4 6.6l-1.5 1.6" stroke="var(--brand)"
                    strokeWidth="1.7" strokeLinecap="round" opacity=".55" />
            </svg>
            <span className="eyebrow">Morning Ledger</span>
          </div>
          <h1>Plan the day before the day plans you.</h1>
          <p className="soft" style={{ fontSize: ".95rem", maxWidth: "40ch" }}>
            Milestones and tasks live in GitLab. The standup, the todo lists and
            what carries over live here.
          </p>
        </div>

        {error && <Notice tone="overdue">{error}</Notice>}
        {failure && <Notice tone="overdue">{failure}</Notice>}

        <div className="panel rise" style={{ padding: 22, animationDelay: "80ms" }}>
          {oauthReady ? (
            <a
              href={`/api/proxy/api/auth/gitlab/login?next=${encodeURIComponent(next)}`}
              className="btn btn-primary btn-lg"
              style={{ width: "100%" }}
            >
              Continue with GitLab
            </a>
          ) : (
            <div className="stack gap-2">
              <div className="row gap-2 center">
                <span className="dot" style={{ background: "var(--attention)" }} />
                <strong style={{ fontSize: ".88rem" }}>GitLab sign-in is not set up</strong>
              </div>
              <p className="soft" style={{ fontSize: ".83rem" }}>
                Add <code className="mono">GITLAB_OAUTH_CLIENT_ID</code> and{" "}
                <code className="mono">GITLAB_OAUTH_CLIENT_SECRET</code> to{" "}
                <code className="mono">.env</code> and restart Django. The application
                needs the <code className="mono">api</code> and{" "}
                <code className="mono">read_user</code> scopes.
              </p>
            </div>
          )}
        </div>

        {demoReady && (
          <form onSubmit={demoSignIn} className="panel rise stack gap-4"
                style={{ padding: 22, animationDelay: "140ms" }}>
            <div className="stack gap-1">
              <span className="eyebrow">Demo</span>
              <h3>Have a look around without GitLab</h3>
              <p className="faint" style={{ fontSize: ".8rem" }}>
                Nothing here touches a real repository. Projects, milestones and
                issues are simulated locally.
              </p>
            </div>

            <label className="lbl">
              Your name
              <input className="field" value={name} required
                     onChange={(e) => setName(e.target.value)}
                     placeholder="Riya Sharma" />
            </label>

            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="lbl">
                Role
                <select className="field" value={role} onChange={(e) => setRole(e.target.value)}>
                  {(config?.roles ?? []).map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </label>
              <label className="lbl">
                Department
                <select className="field" value={department}
                        onChange={(e) => setDepartment(e.target.value)}>
                  {(config?.departments ?? []).map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="lbl">
              Job title <span className="faint" style={{ fontWeight: 400 }}>— optional</span>
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
                     placeholder="Engineering manager" />
            </label>

            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              {busy && <span className="spin" />}
              {busy ? "Signing in" : "Enter the demo"}
            </button>
          </form>
        )}

        {!config && (
          <Notice tone="overdue">
            The server is not responding. Start Django on port 8000, then reload.
          </Notice>
        )}
      </div>
    </main>
  );
}

function Notice({ tone, children }: { tone: "overdue" | "attention"; children: React.ReactNode }) {
  return (
    <div
      className="panel fade"
      style={{
        padding: "12px 15px",
        fontSize: ".84rem",
        background: `var(--${tone}-wash)`,
        borderColor: `var(--${tone})`,
        color: `var(--${tone})`,
      }}
    >
      {children}
    </div>
  );
}
