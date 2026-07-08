"use client";

/**
 * Leaf physics: cards tilt toward the pointer in 3D with a moving glare,
 * spring-settled, and lie flat again when the pointer leaves. Disabled for
 * reduced-motion users and inert on touch (mobile gets its own physics).
 */

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

const SPRING = { stiffness: 170, damping: 20, mass: 0.6 };

export function Tilt({
  children,
  className,
  max = 6,
  lift = true,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
  lift?: boolean;
}) {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), SPRING);
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), SPRING);
  const glareX = useTransform(px, [0, 1], [20, 80]);
  const glareY = useTransform(py, [0, 1], [15, 85]);
  const glare = useMotionTemplate`radial-gradient(320px circle at ${glareX}% ${glareY}%, rgba(243,240,228,0.07), transparent 70%)`;
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <div className={className} style={{ perspective: 900 }}>
      <motion.div
        onPointerMove={(e) => {
          if (e.pointerType === "touch") return;
          const rect = e.currentTarget.getBoundingClientRect();
          px.set((e.clientX - rect.left) / rect.width);
          py.set((e.clientY - rect.top) / rect.height);
        }}
        onPointerLeave={() => {
          px.set(0.5);
          py.set(0.5);
        }}
        whileHover={lift ? { z: 12, scale: 1.012 } : undefined}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d", height: "100%" }}
        className="relative h-full"
      >
        {children}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{ background: glare, transform: "translateZ(1px)" }}
        />
      </motion.div>
    </div>
  );
}
