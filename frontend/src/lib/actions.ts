/**
 * Running a write without making the person wait for it.
 *
 * The old shape was: await the write, then `router.refresh()`, then wait for the
 * server to re-render the whole route. Two serial round trips before a tick mark
 * moved, on a screen whose data comes from half a dozen endpoints. Every small
 * action felt like a page load because it was one.
 *
 * The shape here is: change the screen, say so, and send the write afterwards.
 * That is a promise made on the server's behalf before it has answered, so the
 * whole point of this module is what happens when the promise is broken — the
 * failure comes back as a notification naming the action, holding the exact
 * request, and offering to send it again.
 *
 * Nothing in here is React. The provider in `components/Activity.tsx` owns the
 * state; this owns the network.
 */

export type Method = "POST" | "PATCH" | "PUT" | "DELETE";

export type ActionSpec = {
  /**
   * Identifies the *action*, not the attempt. Ticking the same todo twice is
   * one thing that may have gone wrong, not two, and this is what folds those
   * together in the notification tray. Include the id and the intent:
   * `todo:41:close`.
   */
  key: string;
  /** Present tense, shown the instant the button is pressed. "Closing “Fix login”" */
  pending: string;
  /** Past tense, shown when it lands. "Closed “Fix login”" */
  done: string;
  /** What the notification says if it never lands. "Could not close “Fix login”" */
  failed: string;
  method: Method;
  /** A Django path — `/api/daily/todos/41`. Proxied, never called directly. */
  path: string;
  body?: unknown;
  /** Where in the app to go to see the thing this was about. */
  targetUrl?: string;
  /** Skip the shared refresh after this one lands. */
  quiet?: boolean;
  /**
   * Called with the response body if it lands.
   *
   * For the handful of writes whose *answer* matters and not just their
   * success — adding somebody to a project reports back whether their branch
   * was actually cut. Runs after the fact, so it must not be the only way the
   * screen learns what happened.
   */
  onSuccess?: (data: unknown) => void;
};

export type ActionOutcome =
  | { ok: true; data: unknown }
  | { ok: false; reason: string; status: number | null; retryable: boolean };

/** How many times a request is sent again before a person is told about it. */
const ATTEMPTS = 3;
/** Doubling from here: 400ms, then 800ms. */
const BACKOFF_MS = 400;
/**
 * Long enough for a slow GitLab write behind a VPN, short enough that a hung
 * connection surfaces as a failure rather than as a spinner nobody can clear.
 */
const TIMEOUT_MS = 45_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether sending this again could plausibly produce a different answer.
 *
 * A 4xx is the server saying the request itself is wrong — not permitted, not
 * found, badly formed. Retrying it just fails three times instead of once and
 * makes the app feel broken rather than honest. 408 and 429 are the exceptions:
 * both explicitly mean "later".
 */
function retryable(status: number | null): boolean {
  if (status === null) return true; // network died mid-flight
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

function describe(status: number | null, detail: string): string {
  if (status === null) return "The server could not be reached.";
  if (status === 401 || status === 403) return "You are not allowed to do that.";
  if (status === 404) return "It no longer exists.";
  if (status >= 500) return "The server failed while saving it.";
  return detail || `The server refused it (${status}).`;
}

/** Pull something human out of whatever DRF sent back. */
async function readDetail(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json();
    if (typeof payload === "string") return payload;
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const first = record.detail ?? Object.values(record)[0];
      if (typeof first === "string") return first;
      if (Array.isArray(first) && typeof first[0] === "string") return first[0];
    }
  } catch {
    /* not JSON; the status alone will have to do */
  }
  return "";
}

/**
 * Send one action, retrying only what is worth retrying.
 *
 * Every request goes through the Next proxy, which is what attaches the httpOnly
 * auth cookies and the CSRF header. A path is required to start `/api/` for the
 * same reason the backend validates it: these come back out of stored
 * notifications, and a stored absolute URL would be a way to make the browser
 * call somewhere else carrying the session.
 */
export async function send(spec: ActionSpec): Promise<ActionOutcome> {
  if (!spec.path.startsWith("/api/") || spec.path.startsWith("//")) {
    return { ok: false, reason: "Refusing to send that request.", status: null, retryable: false };
  }

  let status: number | null = null;
  let detail = "";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`/api/proxy${spec.path}`, {
        method: spec.method,
        headers: { "Content-Type": "application/json" },
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;

      if (response.ok) {
        const data = response.status === 204 ? null : await response.json().catch(() => null);
        return { ok: true, data };
      }
      detail = await readDetail(response);
      if (!retryable(status)) break;
    } catch {
      // Thrown rather than returned: offline, DNS, or the timeout above.
      status = null;
    }
    if (attempt < ATTEMPTS) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
  }

  return { ok: false, reason: describe(status, detail), status, retryable: retryable(status) };
}
