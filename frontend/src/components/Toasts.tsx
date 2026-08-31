"use client";

/**
 * The immediate acknowledgement.
 *
 * Deliberately the smallest thing on screen that can still be read at a glance.
 * It appears already saying the action is done, because by then the screen has
 * already changed to match; the small pulsing dot is the only admission that
 * the server has not confirmed it yet, and it goes out when it does.
 *
 * Portalled to the body: the page header sets `isolation: isolate`, and
 * anything fixed rendered inside it gets painted underneath the content it is
 * supposed to sit over.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useActivity } from "./Activity";

export function Toasts() {
  const { toasts } = useActivity();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-state={toast.state}>
          <span className="toast-mark" aria-hidden>
            {toast.state === "failed" ? "!" : <Tick />}
          </span>
          <span>{toast.text}</span>
          {toast.state === "saving" && <span className="toast-dot" aria-hidden />}
        </div>
      ))}
    </div>,
    document.body,
  );
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.4l2.4 2.4L9.6 3.6" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
