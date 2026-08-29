"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Avatar } from "./ui";
import { ThemeToggle } from "./ThemeToggle";
import type { User } from "@/lib/types";

const OWNER_NAV = [
  { href: "/", label: "Today", hint: "Everything at a glance" },
  { href: "/projects", label: "Projects", hint: "Repositories and plans" },
  { href: "/team", label: "Team", hint: "People and their days" },
  { href: "/morning", label: "Morning meeting", hint: "Run the round" },
  { href: "/reports", label: "Reports", hint: "Daily and weekly, as Excel" },
  { href: "/my-day", label: "My day", hint: "Your own list" },
];

const MEMBER_NAV = [{ href: "/my-day", label: "My day", hint: "Today's list" }];

export function Rail({ user }: { user: User }) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = user.is_owner ? OWNER_NAV : MEMBER_NAV;

  async function signOut() {
    await fetch("/api/proxy/api/auth/sign-out", { method: "POST" });
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <aside className="rail">
      <div style={{ padding: "20px 18px 16px" }}>
        <Link href={user.is_owner ? "/" : "/my-day"} className="row gap-2 center">
          <Sunrise />
          <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "1rem",
                         letterSpacing: "-.02em" }}>
            Morning Ledger
          </span>
        </Link>
      </div>

      <nav className="stack gap-1" style={{ padding: "0 12px", flex: 1 }}>
        {nav.map((item) => {
          const active = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className="nav-link" data-active={active}>
              <span className="stack">
                <span>{item.label}</span>
                <span className="faint" style={{ fontSize: ".7rem", fontWeight: 400 }}>
                  {item.hint}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="stack gap-3" style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
        <ThemeToggle />
        <div className="row gap-2 center">
          <Avatar name={user.display_name} url={user.gitlab_avatar_url || undefined} />
          <span className="stack grow">
            <span style={{ fontSize: ".82rem", fontWeight: 500 }}>{user.display_name}</span>
            <span className="faint" style={{ fontSize: ".7rem" }}>
              {user.job_title || (user.is_owner ? "Project owner" : "Project member")}
            </span>
          </span>
        </div>
        <button onClick={signOut} className="btn btn-ghost btn-sm" style={{ alignSelf: "start" }}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

/** The mark: a sun just under the horizon. Blue hour, not sunrise. */
function Sunrise() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="15" r="5.2" fill="var(--brand)" opacity=".9" />
      <path d="M2 17.4h20" stroke="var(--ink)" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 4.4v2.2M5.6 6.6l1.5 1.6M18.4 6.6l-1.5 1.6" stroke="var(--brand)"
            strokeWidth="1.7" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}
