"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A dialog, rendered at the document root.
 *
 * The portal is not decoration. Both dialogs are triggered from inside the
 * page header, which carries `.dawn` and therefore `isolation: isolate` — a
 * stacking context. A `z-index` set inside one only competes with its
 * siblings, so the dialog rendered *behind* the page content below the header.
 * Rendering at the root takes it out of that context entirely.
 */
export function Modal({ label, onClose, children }: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Stop the page behind scrolling under the dialog.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fade"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(8, 13, 25, .55)",
        backdropFilter: "blur(3px)",
        display: "grid", placeItems: "center", padding: 20,
        overflowY: "auto",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>,
    document.body,
  );
}
