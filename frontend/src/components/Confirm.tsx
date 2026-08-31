"use client";

/**
 * "Are you sure" for the one action in this app that is easy to take by
 * accident and awkward to explain afterwards: unticking something.
 *
 * Ticking is one click and stays one click — it is the common case and the
 * whole point of the list. Reversing a tick asks first, because the two
 * buttons sit on top of each other and a stray click on a finished line
 * otherwise silently reopens work the morning meeting has already been told
 * about.
 *
 * Autofocuses the confirm button so Enter is the answer and Escape is the way
 * out, which is how every other dialog in the app already behaves.
 */

import { useEffect, useRef } from "react";
import { Modal } from "./Modal";

export function Confirm({
  title, body, confirmLabel, cancelLabel = "Keep it as it is", tone = "normal",
  onConfirm, onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "normal" | "attention";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmButton.current?.focus(); }, []);

  return (
    <Modal label={title} onClose={onCancel}>
      <div
        className="panel stack gap-4 rise"
        style={{ padding: 24, width: "100%", maxWidth: 400,
                 boxShadow: "var(--shadow-lg)" }}
      >
        <div className="stack gap-2">
          <h2 style={{ fontSize: "1.05rem" }}>{title}</h2>
          {body && (
            <p className="faint" style={{ fontSize: ".84rem", lineHeight: 1.55 }}>{body}</p>
          )}
        </div>
        <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmButton}
            className={`btn btn-sm ${tone === "attention" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
