"use client";

/**
 * The unfurl: each page enters like a leaf opening from the branch —
 * hinged at the top, rotating flat as it fades in. Templates remount per
 * route, which is exactly what makes this a page transition.
 */

import { motion, useReducedMotion } from "framer-motion";

export default function Template({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 18, rotateX: -7 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.55, ease: [0.25, 0.1, 0.15, 1] }}
      style={{ transformPerspective: 1200, transformOrigin: "top center" }}
    >
      {children}
    </motion.div>
  );
}
