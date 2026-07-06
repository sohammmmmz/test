"use client";

import clsx from "clsx";

interface Props {
  connected: boolean;
  listening: boolean;
  onConnect: () => void;
  onStart: () => void;
  onStop: () => void;
}

/** Push-to-talk: hold to stream mic PCM into Gemini Live. */
export function VoiceButton({ connected, listening, onConnect, onStart, onStop }: Props) {
  if (!connected) {
    return (
      <button
        onClick={onConnect}
        className="px-3 py-2 rounded-lg border border-canopy-700 text-cream-300 hover:bg-canopy-800 transition-colors duration-300 ease-sloth text-sm"
        title="Connect voice (Gemini Live)"
      >
        🎙 Enable voice
      </button>
    );
  }
  return (
    <button
      onMouseDown={onStart}
      onMouseUp={onStop}
      onMouseLeave={onStop}
      onTouchStart={(e) => { e.preventDefault(); onStart(); }}
      onTouchEnd={onStop}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") onStart(); }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") onStop(); }}
      className={clsx(
        "px-3 py-2 rounded-lg border text-sm transition-all duration-300 ease-sloth",
        listening
          ? "border-moss-400 bg-moss-500/20 text-moss-300 shadow-[0_0_12px_rgba(138,168,111,0.4)]"
          : "border-canopy-700 text-cream-300 hover:bg-canopy-800",
      )}
      title="Hold to talk"
      aria-pressed={listening}
    >
      {listening ? "● listening" : "🎙 hold to talk"}
    </button>
  );
}
