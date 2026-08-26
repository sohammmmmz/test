import { initials } from "@/lib/format";

/**
 * The carry-thread.
 *
 * One strand per working day a todo has survived. Deliberately not a number:
 * the mark accumulates, so a line that has been rolling all week reads as
 * heavier at a glance without anyone parsing a figure. Colour escalates only
 * once it is genuinely old, so the common case stays quiet.
 */
export function Thread({ days, stale }: { days: number; stale?: boolean }) {
  if (days <= 0) return <span className="thread" aria-hidden />;
  // Capped at five: past that the mark stops meaning "a bit older" and just
  // becomes a block of colour. Red is held back for the genuinely stuck.
  const strands = Math.min(days, 5);
  const tone = days >= 8 ? "thread-old" : stale || days >= 3 ? "thread-stale" : "";
  return (
    <span
      className={`thread ${tone}`}
      title={`Carried for ${days} working ${days === 1 ? "day" : "days"}`}
      role="img"
      aria-label={`Carried for ${days} working ${days === 1 ? "day" : "days"}`}
    >
      {Array.from({ length: strands }, (_, i) => <i key={i} />)}
    </span>
  );
}

export function Avatar({ name, large, url }: { name: string; large?: boolean; url?: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`avatar ${large ? "avatar-lg" : ""}`}
        style={{ objectFit: "cover" }}
      />
    );
  }
  return <span className={`avatar ${large ? "avatar-lg" : ""}`}>{initials(name)}</span>;
}

export function Meter({ percent, tone }: { percent: number; tone?: "done" | "late" }) {
  return (
    <span
      className={`meter ${tone === "done" ? "meter-done" : tone === "late" ? "meter-late" : ""}`}
      role="img"
      aria-label={`${percent}% complete`}
    >
      <i style={{ width: `${Math.max(percent, 1)}%` }} />
    </span>
  );
}

export function Empty({ title, body, action }: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <strong style={{ color: "var(--ink)", fontSize: ".95rem" }}>{title}</strong>
      <span style={{ maxWidth: "42ch" }}>{body}</span>
      {action && <span style={{ marginTop: 8 }}>{action}</span>}
    </div>
  );
}

export function Tick() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.4l2.4 2.4L9.6 3.6" stroke="#fff" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatTile({ label, value, hint, tone, index = 0 }: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: string;
  index?: number;
}) {
  return (
    <div className="panel rise" style={{ padding: "15px 17px", animationDelay: `${index * 55}ms` }}>
      <div className="eyebrow">{label}</div>
      <div
        className="mono"
        style={{ fontSize: "1.85rem", lineHeight: 1.1, marginTop: 6,
                 fontWeight: 600, color: tone ?? "var(--ink)" }}
      >
        {value}
      </div>
      {hint && <div className="faint" style={{ fontSize: ".76rem", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
