/**
 * Two backend URLs, and the difference matters.
 *
 * `BACKEND_INTERNAL_URL` is server-to-server. Inside Docker that is a hostname
 * only the Next server can resolve.
 *
 * `NEXT_PUBLIC_BACKEND_URL` is what the *browser* navigates to. The OAuth
 * handshake has to be a real navigation — Django redirects onward to GitLab —
 * so it cannot go through a fetch or the API proxy.
 */

export const BACKEND_PUBLIC_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

/** Where the popup starts the authorization-code flow. */
export function gitlabLoginUrl(next = "/", invite?: string | null): string {
  const params = new URLSearchParams({ next });
  if (invite) params.set("invite", invite);
  return `${BACKEND_PUBLIC_URL}/api/auth/gitlab/login?${params}`;
}

/**
 * How the popup tells the window that opened it that the flow finished.
 *
 * Not `window.opener.postMessage`, which is the obvious choice and does not
 * work here: GitLab serves `Cross-Origin-Opener-Policy: same-origin`, so the
 * moment the popup lands on gitlab.com the browser severs the opener link for
 * good. `opener` is null on the way back and `popup.closed` starts reporting
 * true for a window that is plainly still open.
 *
 * BroadcastChannel is same-origin and unaffected by any of that. The sign-in
 * screen also polls its own session as a backstop, so the flow completes even
 * where BroadcastChannel is unavailable.
 */
export const OAUTH_CHANNEL = "morning-ledger:gitlab";

export type OAuthResult =
  | { status: "ok"; next: string }
  | { status: "error"; error: string };
