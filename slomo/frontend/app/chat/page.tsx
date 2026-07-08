"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { motion } from "framer-motion";
import { wsUrl } from "@/lib/api";
import { useSloMoStore } from "@/lib/store";
import { useGeminiLive } from "@/lib/gemini-live";
import { VoiceButton } from "@/components/VoiceButton";

interface Bubble {
  id: number;
  role: "user" | "slomo" | "system";
  text: string;
  traceId?: string;
}

interface ConfirmRequest {
  tool: string;
  args: Record<string, unknown>;
  message: string;
}

const SLASH_HINTS = ["/new", "/list", "/attach <project>", "/kill <pid>", "/status", "/memory"];

let bubbleId = 0;

export default function ChatPage() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const userTranscriptRef = useRef("");
  const setAvatar = useSloMoStore((s) => s.setAvatar);
  const voiceReply = useSloMoStore((s) => s.voiceReply);
  const toggleVoiceReply = useSloMoStore((s) => s.toggleVoiceReply);
  const voiceReplyRef = useRef(voiceReply);
  voiceReplyRef.current = voiceReply;

  const add = useCallback((role: Bubble["role"], text: string, traceId?: string) => {
    setBubbles((prev) => [...prev, { id: bubbleId++, role, text, traceId }]);
  }, []);

  const gemini = useGeminiLive({
    // Two-agent handshake: Gemini transcribes; the LangGraph agent does the work.
    onUserTranscript: (text) => {
      userTranscriptRef.current += text;
    },
    onSpeakingChange: (speaking) => setAvatar(speaking ? "speaking" : "idle"),
    onError: (err) => add("system", `voice error: ${err}`),
  });
  const geminiRef = useRef(gemini);
  geminiRef.current = gemini;

  const sendToSloMo = useCallback((text: string, channel: "text" | "voice") => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "user", text, channel }));
  }, []);

  useEffect(() => {
    const ws = new WebSocket(wsUrl("/ws/chat"));
    wsRef.current = ws;
    ws.onopen = () => setWsReady(true);
    ws.onclose = () => setWsReady(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "state":
          setAvatar(msg.state === "idle" ? "idle" : msg.state);
          break;
        case "node":
          if (msg.name === "tool_exec") setAvatar("working");
          break;
        case "confirm_request":
          setConfirm({ tool: msg.tool, args: msg.args, message: msg.message });
          break;
        case "reply":
          add("slomo", msg.text, msg.trace_id);
          if (voiceReplyRef.current && geminiRef.current.connected) {
            geminiRef.current.narrate(msg.text);
          }
          break;
        case "error":
          add("system", msg.error);
          break;
      }
    };
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    paneRef.current?.scrollTo({ top: paneRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles, confirm]);

  const submitText = () => {
    const text = input.trim();
    if (!text) return;
    add("user", text);
    sendToSloMo(text, "text");
    setInput("");
  };

  // Push-to-talk release: flush the accumulated transcript to the agent.
  const stopMicAndForward = () => {
    gemini.stopMic();
    setAvatar("thinking");
    const transcript = userTranscriptRef.current.trim();
    userTranscriptRef.current = "";
    if (transcript) {
      add("user", transcript);
      sendToSloMo(transcript, "voice");
    } else {
      setAvatar("idle");
    }
  };

  const answerConfirm = (approved: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: "confirm", confirm: approved }));
    setConfirm(null);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-9.5rem)]">
      <div ref={paneRef} className="flex-1 overflow-y-auto space-y-3 pb-4">
        {bubbles.length === 0 && (
          <div className="text-center text-cream-500 pt-16 space-y-3">
            <p className="text-4xl">🦥</p>
            <p className="font-display italic">
              &ldquo;No rush. What are we building today?&rdquo;
            </p>
            <p className="text-xs">
              try: {SLASH_HINTS.join("  ·  ")}
            </p>
          </div>
        )}
        {bubbles.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 24 }}
            className={clsx("flex", b.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              title={b.traceId ? `trace: ${b.traceId}` : undefined}
              className={clsx(
                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                b.role === "user" && "bg-moss-500/15 border border-moss-500/30 text-cream-100",
                b.role === "slomo" && "bg-canopy-900 border border-canopy-700 text-cream-100",
                b.role === "system" && "bg-transparent border border-dashed border-canopy-700 text-cream-500 text-xs",
              )}
            >
              {b.role === "slomo" && <span className="mr-1.5">🦥</span>}
              {b.text}
            </div>
          </motion.div>
        ))}
        {confirm && (
          <div className="mx-auto max-w-md rounded-xl border p-4 space-y-3 text-sm"
            style={{ borderColor: "var(--status-warning)" }}>
            <p className="text-cream-100">⚠ {confirm.message}</p>
            <p className="font-mono text-xs text-cream-500">
              {confirm.tool}({JSON.stringify(confirm.args)})
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => answerConfirm(false)}
                className="px-3 py-1.5 rounded-lg border border-canopy-700 text-cream-300 hover:bg-canopy-800">
                Cancel
              </button>
              <button onClick={() => answerConfirm(true)}
                className="px-3 py-1.5 rounded-lg border text-cream-100"
                style={{ borderColor: "var(--status-critical)", background: "color-mix(in srgb, var(--status-critical) 20%, transparent)" }}>
                Yes, do it
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-canopy-700 pt-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitText()}
            placeholder={wsReady ? "Ask SloMo anything… (or hold the mic)" : "connecting to SloMo…"}
            disabled={!wsReady}
            className="flex-1 rounded-xl bg-canopy-900 border border-canopy-700 px-4 py-2.5 text-sm text-cream-100 placeholder:text-cream-700 focus:outline-none focus:border-moss-400 disabled:opacity-50"
          />
          <VoiceButton
            connected={gemini.connected}
            listening={gemini.listening}
            onConnect={() => {
              void gemini.connect().catch((e) => add("system", `voice connect failed: ${e.message}`));
            }}
            onStart={() => {
              setAvatar("listening");
              void gemini.startMic();
            }}
            onStop={stopMicAndForward}
          />
          <button
            onClick={submitText}
            disabled={!wsReady}
            className="px-4 py-2.5 rounded-xl press-depth bg-moss-500/20 border border-moss-400/40 text-moss-300 text-sm hover:bg-moss-500/30 transition-colors duration-300 ease-sloth disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-cream-500 cursor-pointer w-fit">
          <input type="checkbox" checked={voiceReply} onChange={toggleVoiceReply} className="accent-[#8aa86f]" />
          Voice replies {gemini.connected ? "" : "(enable voice first)"}
        </label>
      </div>
    </div>
  );
}
