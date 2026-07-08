"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useSloMoStore } from "@/lib/store";

const STATE_LABEL: Record<string, string> = {
  idle: "hanging around",
  listening: "listening…",
  thinking: "thinking (slowly)…",
  speaking: "speaking",
  working: "working on it…",
};

/**
 * The signature element: SloMo hangs upside-down from the nav bar (the
 * "branch"). Pure CSS/emoji in Phase 1 — swap for a Rive artboard later by
 * keeping the same data-state contract.
 */
export function SlothAvatar() {
  const avatar = useSloMoStore((s) => s.avatar);
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { y: -46, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 60, damping: 12, delay: 0.2 }}
      className="flex items-start gap-2 select-none"
      aria-live="polite"
    >
      <div className="flex flex-col items-center">
        {/* claws gripping the branch */}
        <div className="h-2 w-6 -mb-1 flex justify-between px-0.5">
          <span className="w-1 h-2 rounded-b bg-cream-700" />
          <span className="w-1 h-2 rounded-b bg-cream-700" />
        </div>
        <div className="sloth text-3xl leading-none rotate-180" data-state={avatar} role="img" aria-label={`SloMo is ${STATE_LABEL[avatar]}`}>
          🦥
        </div>
      </div>
      <div className="mt-3 font-display italic text-sm text-cream-500 transition-all duration-700 ease-sloth">
        {STATE_LABEL[avatar]}
      </div>
    </motion.div>
  );
}
