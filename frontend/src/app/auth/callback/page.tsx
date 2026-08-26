"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OAUTH_MESSAGE } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Where GitLab's round trip lands.
 *
 * By the time this renders the cookies are already set — they rode on the
 * redirect that brought us here. All that is left is to tell whoever started
 * the flow that it finished.
 *
 * The same page serves both shapes of the flow, because it is the only thing
 * that can tell them apart: opened in a popup it messages its opener and
 * closes; opened in a full tab (popup blocked, or the link followed directly)
 * it just navigates on.
 */
export default function CallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [stranded, setStranded] = useState(false);

  const status = params.get("status");
  const next = params.get("next") || "/";
  const error = params.get("error");

  useEffect(() => {
    const opener = window.opener as Window | null;

    if (opener && !opener.closed) {
      opener.postMessage(
        status === "ok"
          ? { source: OAUTH_MESSAGE, status: "ok", next }
          : { source: OAUTH_MESSAGE, status: "error", error: error ?? "oauth_failed" },
        window.location.origin,
      );
      window.close();
      // Some browsers refuse to close a window that script did not open, so
      // do not leave the person staring at a blank page if that happens.
      setTimeout(() => setStranded(true), 600);
      return;
    }

    if (status === "ok") {
      router.replace(next);
      router.refresh();
    } else {
      router.replace(`/sign-in?error=${encodeURIComponent(error ?? "oauth_failed")}`);
    }
  }, [status, next, error, router]);

  return (
    <main
      className="dawn"
      style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}
    >
      <div className="stack gap-3 center" style={{ textAlign: "center", maxWidth: "38ch" }}>
        {status === "ok" ? (
          <>
            <span className="spin" style={{ width: 20, height: 20, color: "var(--brand)" }} />
            <strong style={{ fontSize: "1rem" }}>Signed in</strong>
            <span className="soft" style={{ fontSize: ".88rem" }}>
              {stranded
                ? "You can close this window and go back to the app."
                : "Taking you back…"}
            </span>
          </>
        ) : (
          <>
            <strong style={{ fontSize: "1rem", color: "var(--overdue)" }}>
              GitLab turned the sign-in down
            </strong>
            <span className="soft" style={{ fontSize: ".88rem" }}>
              {stranded
                ? "Close this window and try again."
                : "Taking you back to try again…"}
            </span>
          </>
        )}
      </div>
    </main>
  );
}
