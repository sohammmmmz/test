"use client";

/**
 * Inline terminal drawer talking to ONE Claude Code PTY over
 * /ws/sessions/{id} — bypasses the SloMo router entirely.
 */

import { useEffect, useRef, useState } from "react";
import { wsUrl } from "@/lib/api";

// Phase 1 renders plain text; a real ANSI terminal (xterm.js) is Phase 4.
const CURSOR_FWD = /\x1b\[(\d+)C/g; // cursor-forward carries layout: keep it as spaces
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[=>78]/g;

function toPlainText(data: string): string {
  return data
    .replace(CURSOR_FWD, (_m, n) => " ".repeat(Math.min(Number(n), 200)))
    .replace(ANSI_RE, "");
}

export function ClaudeSessionDrawer({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl(`/ws/sessions/${sessionId}`));
    wsRef.current = ws;
    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") {
        setOutput((prev) => (prev + toPlainText(msg.data)).slice(-60_000));
      }
    };
    return () => ws.close();
  }, [sessionId]);

  useEffect(() => {
    paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight });
  }, [output]);

  const send = () => {
    if (!input.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "input", data: input + "\r" }));
    setInput("");
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[560px] bg-bark-900 border-l border-canopy-700 flex flex-col z-40 shadow-2xl">
      <header className="flex items-center justify-between px-4 py-3 border-b border-canopy-700">
        <div className="flex items-center gap-2 text-sm">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: status === "open" ? "var(--status-good)" : "var(--status-serious)",
            }}
          />
          <span className="font-mono text-cream-300">claude · {sessionId}</span>
        </div>
        <button
          onClick={onClose}
          className="text-cream-500 hover:text-cream-100 px-2 transition-colors duration-300 ease-sloth"
          aria-label="Close session drawer"
        >
          ✕
        </button>
      </header>
      <div ref={paneRef} className="term flex-1 overflow-y-auto p-4 text-cream-300">
        {output || (status === "connecting" ? "connecting to the canopy…" : "no output yet")}
      </div>
      <footer className="p-3 border-t border-canopy-700 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Talk to this Claude directly…"
          className="flex-1 rounded-lg bg-canopy-900 border border-canopy-700 px-3 py-2 text-sm font-mono text-cream-100 placeholder:text-cream-700 focus:outline-none focus:border-moss-400"
        />
        <button
          onClick={send}
          className="px-3 py-2 rounded-lg press-depth bg-moss-500/20 border border-moss-400/40 text-moss-300 text-sm hover:bg-moss-500/30 transition-colors duration-300 ease-sloth"
        >
          Send
        </button>
      </footer>
    </div>
  );
}
