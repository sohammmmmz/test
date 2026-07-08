"use client";

/**
 * The signature loading state: a vine draws itself down, leaves spring open
 * along it, and SloMo unrolls at its tip — swaying, unhurried — while slothy
 * phrases cycle. One choreography, reused everywhere something loads.
 */

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const PHRASES = [
  "unrolling from the branch…",
  "stretching one arm…",
  "moving (slowly)…",
  "no rush, almost there…",
];

const VINE = "M60 2 C48 30 76 46 60 72 C46 95 72 106 60 128";

// leaf sprouting points along the vine: x, y, rotation, mirrored?
const LEAVES = [
  [53, 26, -50, false],
  [69, 50, 40, true],
  [50, 84, -35, false],
  [69, 104, 50, true],
] as const;

const LEAF_PATH = "M0 0 Q7 -3 9 -11 Q1 -9 0 0";

export function SlothLoader({ label, size = 150 }: { label?: string; size?: number }) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (label) return;
    const t = setInterval(() => setTick((n) => n + 1), 2400);
    return () => clearInterval(t);
  }, [label]);

  return (
    <div role="status" className="flex flex-col items-center gap-2 py-8 select-none">
      <div className="relative" style={{ width: size * 0.75, height: size }}>
        <svg viewBox="0 0 120 160" className="h-full w-full overflow-visible">
          <motion.path
            d={VINE}
            fill="none"
            stroke="#8aa86f"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={reduce ? undefined : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.3, ease: [0.25, 0.1, 0.15, 1] }}
          />
          {LEAVES.map(([x, y, r, mirror], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${r}) ${mirror ? "scale(-1 1)" : ""}`}>
              <motion.path
                d={LEAF_PATH}
                fill="#a3bd8c"
                style={{ transformBox: "fill-box", transformOrigin: "0% 100%" }}
                initial={reduce ? undefined : { scale: 0 }}
                animate={reduce ? { scale: 1 } : { scale: [0, 1.2, 1] }}
                transition={{ delay: 0.35 + i * 0.28, duration: 0.55, ease: "easeOut" }}
              />
            </g>
          ))}
        </svg>
        {/* SloMo unrolls at the tip of the vine */}
        <motion.div
          className="absolute left-1/2"
          style={{ top: "76%", x: "-50%" }}
          initial={reduce ? undefined : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.15, type: "spring", stiffness: 160, damping: 14 }}
        >
          <motion.span
            className="block origin-top text-3xl"
            animate={reduce ? { rotate: 180 } : { rotate: [175, 185, 175] }}
            transition={reduce ? undefined : { repeat: Infinity, duration: 3.6, ease: "easeInOut" }}
          >
            🦥
          </motion.span>
        </motion.div>
      </div>
      <motion.p
        key={label ?? tick % PHRASES.length}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="font-display text-sm italic text-cream-500"
      >
        {label ?? PHRASES[tick % PHRASES.length]}
      </motion.p>
      <span className="sr-only">Loading</span>
    </div>
  );
}
