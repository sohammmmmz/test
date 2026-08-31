"use client";

/**
 * The one place that knows an action is in flight.
 *
 * Three jobs, kept together because they are the same job seen from different
 * ends: confirm the action immediately, get the screen back in step with the
 * server once it lands, and — if it never lands — put it somewhere the person
 * will find it with the request still intact.
 *
 * The refresh is deliberately shared and deliberately late. Ten ticks in a row
 * used to be ten full route re-renders racing each other; here they are one,
 * fired once the burst stops. That single change is most of why the app stopped
 * feeling like it was thinking.
 */

import { useRouter } from "next/navigation";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { send, type ActionSpec } from "@/lib/actions";
import type { AppNotification } from "@/lib/types";

/** How long after the last write to re-read the server. */
const REFRESH_DEBOUNCE_MS = 350;
/** A backstop only: failures arrive locally the moment they happen. */
const POLL_MS = 60_000;
const STORE_KEY = "ml:pending-failures:v1";

export type Toast = {
  id: number;
  text: string;
  state: "saving" | "saved" | "failed";
};

type Activity = {
  /** Fire a write. Returns at once; the screen should already show the result. */
  run: (spec: ActionSpec) => void;
  /** Same, but tells you how it went — for the few flows that must know. */
  runAndWait: (spec: ActionSpec) => Promise<boolean>;
  /** Ask for a coalesced re-read of the current route. */
  refreshSoon: () => void;
  toasts: Toast[];
  notifications: AppNotification[];
  unread: number;
  markAllRead: () => void;
  dismiss: (note: AppNotification) => void;
  retry: (note: AppNotification) => void;
  clearRead: () => void;
  /** Actions still in the air, by key — so a row can show it is settling. */
  inFlight: Set<string>;
};

const Ctx = createContext<Activity | null>(null);

/**
 * Never throws when there is no provider.
 *
 * Components using this are rendered in the signed-out shell too — and a
 * missing provider taking down the sign-in page would be a poor trade for a
 * toast. Without one, writes fall back to plain awaited fetches.
 */
export function useActivity(): Activity {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return FALLBACK;
}

const FALLBACK: Activity = {
  run: (spec) => { void send(spec); },
  runAndWait: async (spec) => (await send(spec)).ok,
  refreshSoon: () => {},
  toasts: [],
  notifications: [],
  unread: 0,
  markAllRead: () => {},
  dismiss: () => {},
  retry: () => {},
  clearRead: () => {},
  inFlight: new Set(),
};

// ---------------------------------------------------------------------------
// Failures the server never heard about
// ---------------------------------------------------------------------------

/**
 * A failure is filed on the server so it survives a reload and shows up on the
 * person's other machine. But the most common reason an action fails is that
 * the server is unreachable — in which case filing it there fails too, and the
 * only record would be lost on the next refresh. So it is written to
 * localStorage first and removed once the server has taken it.
 */
function loadLocal(): AppNotification[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as AppNotification[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(items: AppNotification[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, 40)));
  } catch {
    /* private mode, or full. The in-memory copy still works this session. */
  }
}

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [server, setServer] = useState<AppNotification[]>([]);
  const [local, setLocal] = useState<AppNotification[]>([]);
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);

  useEffect(() => { setLocal(loadLocal()); }, []);

  // -- the shared, coalesced refresh ---------------------------------------
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  // -- toasts ---------------------------------------------------------------
  const pushToast = useCallback((text: string, state: Toast["state"]) => {
    const id = ++toastId.current;
    setToasts((all) => [...all, { id, text, state }]);
    // Failures linger: they point at the tray, and a person who blinked should
    // not have to guess what the red flash said.
    const life = state === "failed" ? 7000 : 2600;
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), life);
    return id;
  }, []);

  const settleToast = useCallback((id: number, text: string, state: Toast["state"]) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, text, state } : t)));
    if (state === "failed") {
      setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 7000);
    }
  }, []);

  // -- the notification tab -------------------------------------------------
  const loadServer = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/api/notifications/", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { items: AppNotification[] };
      setServer(payload.items ?? []);
    } catch {
      /* offline. The local copy is what the tray shows until it comes back. */
    }
  }, []);

  useEffect(() => {
    loadServer();
    const tick = () => { if (!document.hidden) loadServer(); };
    const timer = setInterval(tick, POLL_MS);
    // Coming back to the tab is the moment worth re-reading — a poll that runs
    // in a background tab for an hour is load nobody is looking at.
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [loadServer]);

  const fileFailure = useCallback(async (spec: ActionSpec, reason: string) => {
    const record: AppNotification = {
      id: -Date.now(),
      kind: "failed",
      title: spec.failed,
      body: reason,
      target_url: spec.targetUrl ?? "",
      dedupe_key: spec.key,
      attempts: 1,
      retry_method: spec.method,
      retry_path: spec.path,
      retry_body: (spec.body ?? null) as AppNotification["retry_body"],
      is_read: false,
      is_resolved: false,
      can_retry: true,
      read_at: null,
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      local: true,
    };

    // Local first — this is the copy that exists even when nothing else does.
    setLocal((all) => {
      const next = [record, ...all.filter((n) => n.dedupe_key !== spec.key)];
      saveLocal(next);
      return next;
    });

    try {
      const res = await fetch("/api/proxy/api/notifications/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "failed", title: record.title, body: record.body,
          target_url: record.target_url, dedupe_key: record.dedupe_key,
          retry_method: record.retry_method, retry_path: record.retry_path,
          retry_body: record.retry_body,
        }),
      });
      if (!res.ok) return;
      // The server has it now, with a real id. Drop the stand-in rather than
      // showing the same failure twice.
      setLocal((all) => {
        const next = all.filter((n) => n.dedupe_key !== spec.key);
        saveLocal(next);
        return next;
      });
      loadServer();
    } catch {
      /* Kept locally. It will be filed on the next failure that gets through. */
    }
  }, [loadServer]);

  // -- running an action ----------------------------------------------------
  const perform = useCallback(async (spec: ActionSpec): Promise<boolean> => {
    const id = pushToast(spec.done, "saving");
    setInFlight((keys) => new Set(keys).add(spec.key));

    const outcome = await send(spec);

    setInFlight((keys) => {
      const next = new Set(keys);
      next.delete(spec.key);
      return next;
    });

    if (outcome.ok) {
      settleToast(id, spec.done, "saved");
      spec.onSuccess?.(outcome.data);
      // A failure that has now succeeded stops being news.
      setLocal((all) => {
        if (!all.some((n) => n.dedupe_key === spec.key)) return all;
        const next = all.filter((n) => n.dedupe_key !== spec.key);
        saveLocal(next);
        return next;
      });
      if (!spec.quiet) refreshSoon();
      return true;
    }

    settleToast(id, `${spec.failed} — see notifications`, "failed");
    await fileFailure(spec, outcome.reason);
    // Put the screen back in step with what the server actually holds. The
    // optimistic change is now known to be a lie, and leaving it on screen next
    // to a failure notice is the worst of both.
    refreshSoon();
    return false;
  }, [pushToast, settleToast, fileFailure, refreshSoon]);

  const run = useCallback((spec: ActionSpec) => { void perform(spec); }, [perform]);

  // -- tray controls --------------------------------------------------------
  const notifications = useMemo(() => {
    const seen = new Set(local.map((n) => n.dedupe_key).filter(Boolean));
    const merged = [
      ...local,
      ...server.filter((n) => !n.dedupe_key || !seen.has(n.dedupe_key)),
    ];
    return merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [local, server]);

  const unread = useMemo(
    () => notifications.filter((n) => !n.is_read && !n.is_resolved).length,
    [notifications],
  );

  const markAllRead = useCallback(() => {
    setServer((all) => all.map((n) => ({ ...n, is_read: true })));
    setLocal((all) => {
      const next = all.map((n) => ({ ...n, is_read: true }));
      saveLocal(next);
      return next;
    });
    fetch("/api/proxy/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }, []);

  const dismiss = useCallback((note: AppNotification) => {
    if (note.local) {
      setLocal((all) => {
        const next = all.filter((n) => n.dedupe_key !== note.dedupe_key);
        saveLocal(next);
        return next;
      });
      return;
    }
    setServer((all) => all.filter((n) => n.id !== note.id));
    fetch(`/api/proxy/api/notifications/${note.id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const clearRead = useCallback(() => {
    setServer((all) => all.filter((n) => !n.is_read));
    setLocal((all) => {
      const next = all.filter((n) => !n.is_read);
      saveLocal(next);
      return next;
    });
    fetch("/api/proxy/api/notifications/clear", { method: "DELETE" }).catch(() => {});
  }, []);

  const retry = useCallback((note: AppNotification) => {
    if (!note.retry_path) return;
    void (async () => {
      const ok = await perform({
        key: note.dedupe_key || `retry:${note.id}`,
        pending: "Trying again",
        done: "Sent again",
        failed: note.title,
        method: (note.retry_method || "POST") as ActionSpec["method"],
        path: note.retry_path,
        body: note.retry_body ?? undefined,
        targetUrl: note.target_url,
      });
      if (!ok) return;
      if (note.local) {
        setLocal((all) => {
          const next = all.filter((n) => n.dedupe_key !== note.dedupe_key);
          saveLocal(next);
          return next;
        });
        return;
      }
      // Resolved rather than deleted: the tray should be able to say it came
      // good, instead of the line quietly vanishing.
      setServer((all) =>
        all.map((n) => (n.id === note.id ? { ...n, is_resolved: true, is_read: true, kind: "done" } : n)));
      fetch(`/api/proxy/api/notifications/${note.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: true }),
      }).catch(() => {});
    })();
  }, [perform]);

  const value = useMemo<Activity>(() => ({
    run, runAndWait: perform, refreshSoon, toasts, notifications, unread,
    markAllRead, dismiss, retry, clearRead, inFlight,
  }), [run, perform, refreshSoon, toasts, notifications, unread,
       markAllRead, dismiss, retry, clearRead, inFlight]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
