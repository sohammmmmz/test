"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OAUTH_CHANNEL, type OAuthResult, gitlabLoginUrl } from "@/lib/config";
import type { AuthConfig } from "@/lib/types";

const POPUP_WIDTH = 560;
const POPUP_HEIGHT = 720;

/** How often the backstop asks whether the session has appeared. */
const POLL_MS = 1500;

/**
 * The way in.
 *
 * GitLab is the only door: assigning an issue needs a real account id, so
 * somebody who exists only in this database could never be given work.
 *
 * The handshake runs in a popup rather than by navigating the whole page. The
 * sign-in screen stays where it is, so a failed authorization returns to the
 * same place instead of a cold start, and the app behind it keeps its state.
 * If the browser blocks the popup we fall back to a full navigation, which is
 * the same flow in a different window.
 */
export function SignIn({ config, error, next, invite, team }: {
  config: AuthConfig | null;
  error: string | null;
  next: string;
  /** Set when arriving from a team invite link. */
  invite?: string | null;
  /** The team the invite joins, for the heading. */
  team?: string | null;
}) {
  const router = useRouter();
  const [connecting, setConnectingRaw] = useState(false);
  const setConnecting = (v: boolean) => {
    console.log('PROBE setConnecting(' + v + ') from:\n' + new Error().stack);
    setConnectingRaw(v);
  };
  const [failure, setFailure] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  const watcher = useRef<ReturnType<typeof setInterval> | null>(null);

  const ready = config?.oauth_configured ?? false;

  const stop = useCallback(() => {
    if (watcher.current) {
      clearInterval(watcher.current);
      watcher.current = null;
    }
  }, []);

  const finish = useCallback((result: OAuthResult) => {
    stop();
    popup.current?.close();
    popup.current = null;

    if (result.status === "ok") {
      // Leave the spinner up: the navigation is the completion, and flipping
      // the button back first reads as a failure.
      router.replace(result.next || "/");
      router.refresh();
      return;
    }
    setConnecting(false);
    setFailure(messageFor(result.error));
  }, [router, stop]);

  useEffect(() => {
    if (!connecting) return;

    // Three ways of hearing that the popup finished. GitLab severs the opener
    // link (COOP: same-origin), so the obvious one — postMessage from the
    // popup — cannot be relied on; these can.
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(OAUTH_CHANNEL);
      channel.onmessage = (event) => finish(event.data as OAuthResult);
    } catch {
      // Unsupported. The poll below still completes the flow.
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== OAUTH_CHANNEL || !event.newValue) return;
      try {
        finish(JSON.parse(event.newValue) as OAuthResult);
      } catch {
        // Malformed; the poll will settle it.
      }
    }
    window.addEventListener("storage", onStorage);

    // The backstop, and the only part that cannot fail: the cookies are set
    // the moment GitLab redirects back, so a session appearing *is* success,
    // whatever the browser did to our window handles.
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/proxy/api/auth/me", { cache: "no-store" });
        if (!res.ok) return;
        const me = await res.json();
        finish({ status: "ok", next: me.is_onboarded ? (me.is_owner ? "/" : "/my-day") : "/welcome" });
      } catch {
        // Backend momentarily unreachable; try again on the next tick.
      }
    }, POLL_MS);
    watcher.current = poll;

    return () => {
      window.removeEventListener("storage", onStorage);
      channel?.close();
      clearInterval(poll);
    };
  }, [connecting, finish]);

  function connect() {
    setFailure(null);
    setConnecting(true);

    const url = gitlabLoginUrl(next, invite);
    // Centred on the window the person is looking at, not the primary display
    // — those differ constantly on a desk with two screens.
    const left = window.screenX + Math.max(0, (window.outerWidth - POPUP_WIDTH) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - POPUP_HEIGHT) / 2);

    const opened = window.open(
      url,
      "gitlab-sign-in",
      `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${Math.round(left)},top=${Math.round(top)}`,
    );

    if (!opened) {
      // Blocked. The flow works perfectly well in this tab, so use it rather
      // than telling somebody to go and change a browser setting.
      window.location.href = url;
      return;
    }
    popup.current = opened;
    opened.focus();
  }

  function cancel() {
    stop();
    popup.current?.close();
    popup.current = null;
    setConnecting(false);
  }

  return (
    <main
      className="dawn"
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div className="stack gap-6" style={{ width: "100%", maxWidth: 440 }}>

        <div className="stack gap-3 rise">
          <div className="row gap-2 center">
            <Mark />
            <span className="eyebrow">Morning Ledger</span>
          </div>
          {team ? (
            <>
              <h1>Join {team}.</h1>
              <p className="soft" style={{ fontSize: ".95rem", maxWidth: "42ch" }}>
                Signing in with GitLab adds you to the team and sets up your
                daily list. We need your GitLab account because that is what
                tasks are assigned to.
              </p>
            </>
          ) : (
            <>
              <h1>Plan the day before the day plans you.</h1>
              <p className="soft" style={{ fontSize: ".95rem", maxWidth: "40ch" }}>
                Milestones and tasks live in GitLab. The standup, the todo lists
                and what carries over live here.
              </p>
            </>
          )}
        </div>

        {(error || failure) && <Notice>{failure ?? error}</Notice>}

        <div className="panel rise stack gap-4" style={{ padding: 22, animationDelay: "80ms" }}>
          {ready ? (
            <>
              <button
                onClick={connect}
                disabled={connecting}
                className="btn btn-primary btn-lg"
                style={{ width: "100%" }}
              >
                {connecting && <span className="spin" />}
                {connecting
                  ? "Waiting for GitLab…"
                  : team
                    ? "Join with GitLab"
                    : "Continue with GitLab"}
              </button>
              {connecting ? (
                <p className="faint" style={{ fontSize: ".78rem", textAlign: "center" }}>
                  Finish signing in in the GitLab window.{" "}
                  <button
                    onClick={cancel}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: 0, textDecoration: "underline" }}
                  >
                    Cancel
                  </button>
                </p>
              ) : (
                <p className="faint" style={{ fontSize: ".78rem", textAlign: "center" }}>
                  Opens a GitLab window to authorize this app.
                </p>
              )}
            </>
          ) : (
            <div className="stack gap-2">
              <div className="row gap-2 center">
                <span className="dot" style={{ background: "var(--attention)" }} />
                <strong style={{ fontSize: ".9rem" }}>GitLab sign-in is not set up</strong>
              </div>
              <p className="soft" style={{ fontSize: ".84rem" }}>
                Add <code className="mono">GITLAB_OAUTH_CLIENT_ID</code> and{" "}
                <code className="mono">GITLAB_OAUTH_CLIENT_SECRET</code> to{" "}
                <code className="mono">.env</code>, then restart Django. The
                application needs the <code className="mono">api</code> and{" "}
                <code className="mono">read_user</code> scopes —{" "}
                <code className="mono">read_api</code> cannot create milestones,
                issues or branches.
              </p>
            </div>
          )}
        </div>

        {!config && (
          <Notice>
            The server is not responding. Start Django on port 8000, then reload.
          </Notice>
        )}
      </div>
    </main>
  );
}

/** Reasons GitLab hands back, in words that say what to do about them. */
function messageFor(code: string | undefined): string {
  switch (code) {
    case "access_denied":
      return "You declined the authorization request.";
    case "missing_code_or_state":
      return "GitLab came back without an authorization code. Try again.";
    case "oauth_failed":
      return "GitLab turned the sign-in down. Check that the application's redirect URI matches GITLAB_OAUTH_REDIRECT_URI exactly, including the port.";
    default:
      return code || "That sign-in did not complete.";
  }
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="panel fade"
      style={{
        padding: "12px 15px",
        fontSize: ".84rem",
        background: "var(--overdue-wash)",
        borderColor: "var(--overdue)",
        color: "var(--overdue)",
      }}
    >
      {children}
    </div>
  );
}

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="15" r="5.2" fill="var(--brand)" opacity=".9" />
      <path d="M2 17.4h20" stroke="var(--ink)" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 4.4v2.2M5.6 6.6l1.5 1.6M18.4 6.6l-1.5 1.6" stroke="var(--brand)"
            strokeWidth="1.7" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}
