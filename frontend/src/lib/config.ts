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
export function gitlabLoginUrl(next = "/"): string {
  return `${BACKEND_PUBLIC_URL}/api/auth/gitlab/login?next=${encodeURIComponent(next)}`;
}

/** What the popup posts back to the window that opened it. */
export const OAUTH_MESSAGE = "morning-ledger:gitlab";

export type OAuthResult =
  | { source: typeof OAUTH_MESSAGE; status: "ok"; next: string }
  | { source: typeof OAUTH_MESSAGE; status: "error"; error: string };
