import Link from "next/link";
import { redirect } from "next/navigation";
import { ReportControls } from "@/components/ReportControls";
import { Empty, StatTile } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import { plural, shortDate } from "@/lib/format";
import type { ReportPerson, ReportPreview, User } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Reports.
 *
 * What is on screen is what is in the file — same endpoint, same builder — so
 * the download is never a surprise. The page is the preview; the spreadsheet is
 * the copy that gets forwarded to somebody who will never open this app.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");
  if (!user.is_owner) redirect("/my-day");

  const { period: rawPeriod, date: rawDate } = await searchParams;
  const period = rawPeriod === "weekly" ? "weekly" : "daily";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(rawDate ?? "")
    ? (rawDate as string)
    : new Date().toISOString().slice(0, 10);

  let report: ReportPreview;
  try {
    report = await api.get<ReportPreview>(
      `/api/reports/preview?period=${period}&date=${anchor}`,
    );
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/sign-in?next=/reports");
    }
    return (
      <div className="page-body">
        <Empty title="Could not build the report" body="The server did not respond." />
      </div>
    );
  }

  const { summary, projects, people, assignments, activity } = report;
  const busiest = people[0];

  return (
    <>
      <header className="page-head dawn">
        <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
          <div className="stack gap-2">
            <span className="eyebrow">
              {period === "daily" ? "Daily report" : "Weekly report"}
            </span>
            <h1 style={{ maxWidth: "20ch" }}>{report.period.label}</h1>
            <p className="soft" style={{ fontSize: ".93rem", maxWidth: "56ch" }}>
              {summary.active_projects} active {plural(summary.active_projects, "project")} of{" "}
              {summary.projects}, {summary.people} {plural(summary.people, "person", "people")}{" "}
              covered, {summary.tasks_closed} {plural(summary.tasks_closed, "task")} closed in
              the window.
            </p>
          </div>
          <ReportControls period={period} anchor={anchor} filename={report.filename} />
        </div>
      </header>

      <div className="page-body">

        <section className="grid cols-stat">
          <StatTile label="Active projects" value={summary.active_projects}
                    hint={`${summary.projects} tracked`} index={0} />
          <StatTile label="Slipping" value={summary.slipping}
                    hint="past a milestone date"
                    tone={summary.slipping ? "var(--overdue)" : undefined} index={1} />
          <StatTile label="Over capacity" value={summary.over_capacity}
                    hint={`of ${summary.people} ${plural(summary.people, "person", "people")}`}
                    tone={summary.over_capacity ? "var(--attention)" : undefined} index={2} />
          <StatTile label="Closed this period" value={summary.tasks_closed}
                    hint={`${summary.todos_closed} todos, ${summary.meetings_held} ${plural(summary.meetings_held, "round")}`}
                    index={3} />
        </section>

        {/* What the file contains, said plainly before it is downloaded. */}
        <section className="panel rise" style={{ animationDelay: "160ms" }}>
          <div className="panel-head">
            <div className="stack">
              <h2 style={{ fontSize: "1.05rem" }}>What is in the spreadsheet</h2>
              <span className="faint" style={{ fontSize: ".78rem" }}>
                Six sheets, each filtered and frozen. Everything below is the same data.
              </span>
            </div>
            <span className="mono faint" style={{ fontSize: ".74rem" }}>
              {report.filename}
            </span>
          </div>
          <div className="row gap-2 wrap" style={{ padding: "14px 18px" }}>
            <Sheet name="Summary" count={null} note="the headline numbers" />
            <Sheet name="Projects" count={projects.length} note="status and progress" />
            <Sheet name="People" count={people.length} note="bandwidth" />
            <Sheet name="Who is where" count={assignments.length} note="person × project" />
            <Sheet name="Milestones" count={report.milestones.length} note="dates and drift" />
            <Sheet name="Day by day" count={activity.length} note="the shape of the period" />
          </div>
        </section>

        <section className="grid cols-2" style={{ alignItems: "start" }}>
          <div className="panel rise panel-locked" style={{ animationDelay: "200ms" }}>
            <div className="panel-head">
              <h2 style={{ fontSize: "1.05rem" }}>Bandwidth</h2>
              <span className="eyebrow">
                against {summary.capacity_basis} open items
              </span>
            </div>
            <div className="locked-body scroll-x">
              <table className="data" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th style={{ minWidth: 150 }}>Load</th>
                    <th>Open</th>
                    <th>Overdue</th>
                    <th>Projects</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((row) => (
                    <tr key={row.gitlab_username}>
                      <td>
                        <span className="stack">
                          <span style={{ fontWeight: 500 }}>{row.name}</span>
                          <span className="faint" style={{ fontSize: ".72rem" }}>
                            {row.job_title !== "—" ? row.job_title : row.department}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="stack gap-1" style={{ minWidth: 130 }}>
                          <Gauge person={row} />
                          <span className="row between" style={{ fontSize: ".71rem" }}>
                            <span style={{ color: toneOf(row) }}>{row.bandwidth}</span>
                            <span className="mono faint">{row.bandwidth_percent}%</span>
                          </span>
                        </span>
                      </td>
                      <td className="mono">{row.open_tasks + row.todos_open_today}</td>
                      <td className="mono"
                          style={{ color: row.overdue_tasks ? "var(--overdue)" : "var(--ink-faint)" }}>
                        {row.overdue_tasks || "—"}
                      </td>
                      <td className="mono">{row.projects}</td>
                    </tr>
                  ))}
                  {people.length === 0 && (
                    <tr><td colSpan={5}>
                      <Empty title="Nobody to report on"
                             body="Build a team and the people on it appear here."
                             action={<Link href="/team" className="btn btn-sm">Build a team</Link>} />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel rise panel-locked" style={{ animationDelay: "240ms" }}>
            <div className="panel-head">
              <h2 style={{ fontSize: "1.05rem" }}>Projects</h2>
              <span className="eyebrow">{projects.length} tracked</span>
            </div>
            <div className="locked-body scroll-x">
              <table className="data" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Closed</th>
                    <th>Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <span className="stack">
                          <span style={{ fontWeight: 500 }}>{row.name}</span>
                          <span className="mono faint" style={{ fontSize: ".71rem" }}>
                            {row.repository || "no repository"}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${row.is_slipping ? "pill-overdue" : ""}`}>
                          {row.is_slipping ? "slipping" : row.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="mono">
                        {row.percent}%
                        <span className="faint"> · {row.tasks_done}/{row.tasks}</span>
                      </td>
                      <td className="mono">{row.closed_in_period || "—"}</td>
                      <td className="mono faint" style={{ whiteSpace: "nowrap" }}>
                        {row.next_due ? shortDate(row.next_due) : "—"}
                      </td>
                    </tr>
                  ))}
                  {projects.length === 0 && (
                    <tr><td colSpan={5}>
                      <Empty title="No projects yet"
                             body="Create one and it appears in every report from then on." />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="panel rise panel-locked"
                 style={{ animationDelay: "280ms", ["--locked-h" as string]: "30rem" }}>
          <div className="panel-head">
            <div className="stack">
              <h2 style={{ fontSize: "1.05rem" }}>Who is working where</h2>
              <span className="faint" style={{ fontSize: ".78rem" }}>
                One row per person per project, with the branch they own on it.
              </span>
            </div>
            <span className="eyebrow">{assignments.length} {plural(assignments.length, "placement")}</span>
          </div>
          <div className="locked-body scroll-x">
            <table className="data" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Person</th>
                  <th>Branch</th>
                  <th>Open</th>
                  <th>Overdue</th>
                  <th>Closed this period</th>
                  <th>Repo access</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((row, i) => (
                  <tr key={`${row.project}-${row.person}-${i}`}>
                    <td>{row.project}</td>
                    <td style={{ fontWeight: 500 }}>{row.person}</td>
                    <td className="mono faint" style={{ fontSize: ".73rem" }}>{row.branch}</td>
                    <td className="mono">{row.open_tasks}</td>
                    <td className="mono"
                        style={{ color: row.overdue_tasks ? "var(--overdue)" : "var(--ink-faint)" }}>
                      {row.overdue_tasks || "—"}
                    </td>
                    <td className="mono">{row.closed_in_period || "—"}</td>
                    <td>
                      <span className={`pill ${row.on_gitlab === "synced" ? "" : "pill-overdue"}`}>
                        {row.on_gitlab}
                      </span>
                    </td>
                  </tr>
                ))}
                {assignments.length === 0 && (
                  <tr><td colSpan={7}>
                    <Empty title="Nobody is on a project yet"
                           body="Add people to a project and each one gets repo access and a branch." />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {period === "weekly" && (
          <section className="panel rise" style={{ animationDelay: "320ms", overflow: "hidden" }}>
            <div className="panel-head">
              <div className="stack">
                <h2 style={{ fontSize: "1.05rem" }}>The shape of the week</h2>
                <span className="faint" style={{ fontSize: ".78rem" }}>
                  Four quiet days and one where everything closed is a different week
                  from five even ones.
                </span>
              </div>
            </div>
            <div className="scroll-x">
              <table className="data" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Todos set</th>
                    <th>Closed</th>
                    <th>Awaiting</th>
                    <th>Still open</th>
                    <th>Tasks closed</th>
                    <th>Round held</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((row) => (
                    <tr key={row.date} style={{ opacity: row.is_working_day ? 1 : .55 }}>
                      <td>
                        <span className="stack">
                          <span style={{ fontWeight: 500 }}>{row.weekday}</span>
                          <span className="mono faint" style={{ fontSize: ".71rem" }}>
                            {shortDate(row.date)}
                          </span>
                        </span>
                      </td>
                      <td className="mono">{row.todos}</td>
                      <td className="mono" style={{ color: row.closed ? "var(--done)" : undefined }}>
                        {row.closed || "—"}
                      </td>
                      <td className="mono"
                          style={{ color: row.awaiting ? "var(--attention)" : "var(--ink-faint)" }}>
                        {row.awaiting || "—"}
                      </td>
                      <td className="mono">{row.still_open || "—"}</td>
                      <td className="mono">{row.tasks_closed || "—"}</td>
                      <td>{row.meetings > 0 ? "yes" : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="faint" style={{ fontSize: ".78rem", maxWidth: "76ch" }}>
          Bandwidth is open GitLab tasks plus open todos, with overdue work counted
          twice, against a nominal {summary.capacity_basis} items per person
          (<span className="mono">CAPACITY_OPEN_ITEMS</span>). It is a heuristic for
          spotting who to talk to, not a measure of anyone.
          {busiest && busiest.bandwidth_percent > 100 &&
            ` Right now that is ${busiest.name}, at ${busiest.bandwidth_percent}%.`}
        </p>
      </div>
    </>
  );
}

function toneOf(person: ReportPerson): string | undefined {
  if (person.bandwidth === "Over capacity") return "var(--overdue)";
  if (person.bandwidth === "Full") return "var(--attention)";
  if (person.bandwidth === "Spare capacity") return "var(--done)";
  return "var(--ink-soft)";
}

function Gauge({ person }: { person: ReportPerson }) {
  const tone =
    person.bandwidth === "Over capacity" ? "overdue"
      : person.bandwidth === "Full" ? "attention"
        : person.bandwidth === "Spare capacity" ? "done"
          : undefined;

  return (
    <span className="gauge" data-tone={tone} role="img"
          aria-label={`${person.bandwidth}, ${person.bandwidth_percent} percent of capacity`}>
      <i style={{ width: `${Math.min(person.bandwidth_percent, 100)}%` }} />
    </span>
  );
}

function Sheet({ name, count, note }: {
  name: string;
  count: number | null;
  note: string;
}) {
  return (
    <span className="sheet-chip">
      <b>{name}</b>
      {count !== null && <span className="mono faint">{count}</span>}
      <span className="faint">{note}</span>
    </span>
  );
}
