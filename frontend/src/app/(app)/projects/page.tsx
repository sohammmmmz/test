import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateProject } from "@/components/CreateProject";
import { Empty, Meter } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import { plural, relativeDue } from "@/lib/format";
import type { Project, Team, User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");

  let projects: Project[] = [];
  let teams: Team[] = [];
  try {
    [projects, teams] = await Promise.all([
      api.get<Project[]>("/api/projects/"),
      api.get<Team[]>("/api/teams/").catch(() => []),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/sign-in?next=/projects");
    }
    return (
      <div className="page-body">
        <Empty title="Could not load projects" body="The server did not respond. Reload to try again." />
      </div>
    );
  }

  const slipping = projects.filter((p) => p.progress.is_slipping).length;

  return (
    <>
      <header className="page-head dawn">
        <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
          <div className="stack gap-2">
            <span className="eyebrow">Projects</span>
            <h1>{projects.length} {plural(projects.length, "repository", "repositories")}</h1>
            <p className="soft" style={{ fontSize: ".93rem", maxWidth: "54ch" }}>
              Every project is a GitLab repository. Creating one here creates the repo,
              a branch for each member and a documentation branch.
              {slipping > 0 && ` ${slipping} ${plural(slipping, "is", "are")} past a milestone date.`}
            </p>
          </div>
          {user.is_owner && <CreateProject teams={teams} />}
        </div>
      </header>

      <div className="page-body">
        {projects.length === 0 ? (
          <div className="panel">
            <Empty
              title="No projects yet"
              body={user.is_owner
                ? "Create one and its repository, member branches and documentation branch are set up for you."
                : "You have not been added to a project yet. Your project owner adds people to a project from its page."}
            />
          </div>
        ) : (
          <div className="grid cols-auto">
            {projects.map((project, index) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="panel stack gap-4 rise"
                style={{ padding: 19, animationDelay: `${index * 45}ms` }}
              >
                <div className="stack gap-2">
                  <div className="row between gap-2" style={{ alignItems: "flex-start" }}>
                    <h3 style={{ fontSize: "1.06rem" }}>{project.name}</h3>
                    <span className={`pill ${project.progress.is_slipping ? "pill-overdue"
                      : project.status === "active" ? "pill-done" : ""}`}>
                      {project.progress.is_slipping ? "slipping" : project.status}
                    </span>
                  </div>
                  {project.description && (
                    <p className="soft" style={{ fontSize: ".84rem",
                                                 display: "-webkit-box", WebkitLineClamp: 2,
                                                 WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {project.description}
                    </p>
                  )}
                  <span className="mono faint" style={{ fontSize: ".72rem" }}>
                    {project.repo_path ?? "no repository"}
                  </span>
                </div>

                <div className="stack gap-2">
                  <Meter
                    percent={project.progress.percent}
                    tone={project.progress.is_slipping ? "late"
                          : project.progress.percent === 100 ? "done" : undefined}
                  />
                  <div className="row between">
                    <span className="mono faint" style={{ fontSize: ".73rem" }}>
                      {project.progress.completed_tasks}/{project.progress.total_tasks} tasks
                    </span>
                    <span className="mono faint" style={{ fontSize: ".73rem" }}>
                      {project.progress.next_due_date
                        ? relativeDue(project.progress.next_due_date)
                        : "no dates set"}
                    </span>
                  </div>
                </div>

                {/* Readiness reads as four marks rather than a score: which one
                    is missing matters more than how many. */}
                <div className="row between center gap-2"
                     style={{ paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <div className="row gap-1">
                    {project.readiness.checks.map((check) => (
                      <span
                        key={check.key}
                        title={check.passed ? check.label : `${check.label} — ${check.remedy}`}
                        style={{
                          width: 22, height: 4, borderRadius: 3,
                          background: check.passed ? "var(--done)" : "var(--line-firm)",
                        }}
                      />
                    ))}
                  </div>
                  <span className="faint" style={{ fontSize: ".73rem" }}>
                    {project.readiness.is_ready
                      ? "set up"
                      : `${4 - project.readiness.passed} to do`}
                    {" · "}
                    {project.member_count} {plural(project.member_count, "member")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
