/** Formatting that must not disagree between server and client render. */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Mar" — fixed rather than locale-dependent, so SSR and the client agree. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function longDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday",
                  "Thursday", "Friday", "Saturday"];

export function weekday(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : WEEKDAYS[d.getUTCDay()];
}

/** How a due date reads to someone scanning: "in 3 days", "2 days late". */
export function relativeDue(value: string | null | undefined): string {
  if (!value) return "no date";
  const due = new Date(value + "T00:00:00Z");
  if (Number.isNaN(due.getTime())) return "no date";
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((due.getTime() - todayUTC) / 86_400_000);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "1 day late";
  if (days < 0) return `${Math.abs(days)} days late`;
  if (days <= 14) return `in ${days} days`;
  return shortDate(value);
}

export function plural(n: number, one: string, many?: string): string {
  return n === 1 ? one : (many ?? `${one}s`);
}

/**
 * The same as relativeDue, but silent for dates far enough away that a
 * relative phrase adds nothing — otherwise it just restates the date next to
 * the date.
 */
export function dueSoon(value: string | null | undefined): string {
  if (!value) return "";
  const phrase = relativeDue(value);
  return phrase === shortDate(value) ? "" : phrase;
}
