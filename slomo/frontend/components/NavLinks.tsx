"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const NAV = [
  { href: "/health", label: "Health" },
  { href: "/chat", label: "Chat" },
  { href: "/workspace", label: "Workspace" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 py-2" aria-label="Main">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="relative px-3 py-1.5 rounded-lg text-sm text-cream-300 hover:text-cream-100 transition-colors duration-300 ease-sloth"
          >
            {active && (
              <motion.span
                layoutId="nav-leaf"
                className="absolute inset-0 rounded-lg bg-canopy-800 border border-canopy-700"
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
              />
            )}
            <span className={active ? "relative text-cream-100" : "relative"}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
