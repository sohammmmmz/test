"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

/**
 * Three states, not two. "System" is the default and stamps nothing, so the
 * OS preference decides; choosing explicitly stamps the root and wins.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as Theme) || "system";
    setTheme(stored);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode or blocked storage. The choice still applies to this page.
    }
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <div className="row gap-1" role="radiogroup" aria-label="Colour theme">
      {(["light", "system", "dark"] as Theme[]).map((option) => (
        <button
          key={option}
          role="radio"
          aria-checked={theme === option}
          onClick={() => choose(option)}
          className="btn btn-sm"
          style={{
            flex: 1,
            padding: "4px 0",
            fontSize: ".68rem",
            textTransform: "capitalize",
            background: theme === option ? "var(--brand-wash)" : "transparent",
            color: theme === option ? "var(--brand)" : "var(--ink-faint)",
            borderColor: theme === option ? "transparent" : "var(--line)",
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
