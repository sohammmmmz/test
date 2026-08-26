"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OAUTH_CHANNEL, type OAuthResult } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Where GitLab's round trip lands.
 *
 * The cookies are already set by the time this renders — they rode on the
 * redirect that brought us here. All that is left is to tell whoever started
 * the flow that it finished, and get out of the way.
 *
 * The same page serves both shapes of the flow, because it is the only thing
 * that can tell them apart: opened in a popup it announces the result and
 * closes; opened in a full tab it simply navigates on.
 */
export default function CallbackPage() {
  return (
    <Suspense fallback={<Waiting label="Finishing sign-in…" />}>
      <Callback />
    </Suspense>
  );
}

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [stranded, setStranded] = useState(false);

  const ok = params.get("status") === "ok";
  const next = params.get("next") || "/";
  const error = params.get("error") ?? "oauth_failed";

  useEffect(() => {
    const result: OAuthResult = ok ? { status: "ok", next } : { status: "error", error };
    const inPopup = window.opener !== null || window.name === "gitlab-sign-in";

    // Announce on every channel that survives COOP. Whichever the opener is
    // listening on, one of these reaches it.
    try {
      const channel = new BroadcastChannel(OAUTH_CHANNEL);
      channel.postMessage(result);
      channel.close();
    } catch {
      // Not available in this browser; the backstop poll covers it.
    }
    try {
      localStorage.setItem(OAUTH_CHANNEL, JSON.stringify({ ...result, at: Date.now() }));
    } catch {
      // Storage blocked. Same backstop.
    }

    if (inPopup) {
      window.close();
      // A window script did not open cannot be closed by script, so do not
      // leave somebody staring at a blank page if the close is refused.
      const timer = setTimeout(() => setStranded(true), 700);
      return () => clearTimeout(timer);
    }

    if (ok) {
      router.replace(next);
      router.refresh();
    } else {
      router.replace(`/sign-in?error=${encodeURIComponent(error)}`);
    }
  }, [ok, next, error, router]);

  if (!ok) {
    return (
      <Waiting
        tone="var(--overdue)"
        label="GitLab turned the sign-in down"
        detail={stranded ? "Close this window and try again." : "Taking you back…"}
      />
    );
  }

  return (
    <Waiting
      label="Signed in"
      detail={
        stranded
          ? "You can close this window — the app is ready behind it."
          : "Taking you back…"
      }
    />
  );
}

function Waiting({ label, detail, tone }: { label: string; detail?: string; tone?: string }) {
  return (
    <main
      className="dawn"
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div className="stack gap-3 center" style={{ textAlign: "center", maxWidth: "36ch" }}>
        {!tone && <span className="spin" style={{ width: 20, height: 20, color: "var(--brand)" }} />}
        <strong style={{ fontSize: "1rem", color: tone ?? "var(--ink)" }}>{label}</strong>
        {detail && <span className="soft" style={{ fontSize: ".88rem" }}>{detail}</span>}
      </div>
    </main>
  );
}
