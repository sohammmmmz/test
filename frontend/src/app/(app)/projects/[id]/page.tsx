import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DeleteProject } from "@/components/DeleteProject";
import { Documents } from "@/components/Documents";
import { Plan } from "@/components/Plan";
import { ProjectMembers } from "@/components/ProjectMembers";
import { Avatar, Empty, Meter } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import { plural, relativeDue } from "@/lib/format";
import type { Milestone, ProjectDetail, Team, User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");

  let project: ProjectDetail;
  try {
    project = await api.get<ProjectDetail>(`/api/projects/${id}/`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect(`/sign-in?next=/projects/${id}`);
    }
    return (
      <div className="page-body">
        <Empty title="Could not load this project" body="The server did not respond." />
      </div>
    );
  }

  // GitLab is the source of truth, so re-read it on open. Somebody who closed
  // an issue in GitLab's own UI must not have it silently reopened here.
  await api.post(`/api/planning/reconcile/${id}`, {}).catch(() => null);

  const [milestones, teams] = await Promise.all([
    api.get<Milestone[]>(`/api/planning/milestones/?project=${id}`).catch(() => []),
    user.is_owner ? api.get<Team[]>("/api/teams/").catch(() => []) : Promise.resolve([]),
  ]);

  const list = Array.isArray(milestones) ? milestones : [];
  const missing = project.readiness.checks.filter((c) => !c.passed);

  return (
    <>
      <header className="page-head dawn">
        <div className="stack gap-3">
          <Link href="/projects" className="eyebrow" style={{ color: "var(--brand)" }}>
            ← All projects
          </Link>
          <div className="row between wrap gap-4" style={{ alignItems: "flex-end" }}>
            <div className="stack gap-2">
              <h1>{project.name}</h1>
              {project.description && (
                <p className="soft" style={{ fontSize: ".95rem", maxWidth: "60ch" }}>
                  {project.description}
                </p>
              )}
              <div className="row gap-4 wrap center" style={{ fontSize: ".78rem" }}>
                {project.repo?.web_url && (
                  <a href={project.repo.web_url} target="_blank" rel="noreferrer"
                     className="mono" style={{ color: "var(--brand)" }}>
                    {project.repo.path_with_namespace}
                  </a>
                )}
                <span className="mono faint">
                  default branch {project.repo?.default_branch ?? "—"}
                </span>
                <span className="mono faint">
                  {project.member_count} {plural(project.member_count, "member")}
                </span>
              </div>
            </div>

            <div className="stack gap-2" style={{ minWidth: 210 }}>
              <div className="row between">
                <span className="eyebrow">Progress</span>
                <span className="mono" style={{ fontSize: ".8rem", fontWeight: 500 }}>
                  {project.progress.percent}%
                </span>
              </div>
              <Meter percent={project.progress.percent}
                     tone={project.progress.is_slipping ? "late"
                           : project.progress.percent === 100 ? "done" : undefined} />
              <span className="faint" style={{ fontSize: ".76rem" }}>
                {project.progress.completed_tasks}/{project.progress.total_tasks} tasks
                {project.progress.next_milestone &&
                  ` · ${project.progress.next_milestone} ${relativeDue(project.progress.next_due_date)}`}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="page-body">

        {missing.length > 0 && (
          <section className="panel rise" style={{ borderColor: "var(--attention)" }}>
            <div className="panel-head" style={{ borderColor: "var(--line)" }}>
              <div className="row gap-2 center">
                <span className="dot" style={{ background: "var(--attention)" }} />
                <h2 style={{ fontSize: "1rem" }}>
                  {missing.length} {plural(missing.length, "thing")} still to set up
                </h2>
              </div>
            </div>
            <div className="stack">
              {missing.map((check) => (
                <div key={check.key} className="row gap-3"
                     style={{ padding: "11px 18px", borderBottom: "1px solid var(--line)",
                              alignItems: "flex-start" }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, flex: "none",
                                 border: "1.5px dashed var(--line-firm)", marginTop: 1 }} />
                  <span className="stack">
                    <strong style={{ fontSize: ".87rem" }}>{check.label}</strong>
                    <span className="soft" style={{ fontSize: ".82rem" }}>{check.remedy}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <Plan
          projectId={project.id}
          milestones={list}
          members={project.members.map((m) => m.user)}
          canEdit={user.is_owner}
          currentUserId={user.id}
        />

        <section className="grid cols-2-even" style={{ alignItems: "start" }}>
          <ProjectMembers
            projectId={project.id}
            members={project.members}
            teams={teams}
            canEdit={user.is_owner}
          />
          <Documents
            projectId={project.id}
            documents={project.documents}
            canEdit={user.is_owner}
            branch={project.repo?.docs_branch ?? "documentation"}
          />
        </section>

        {user.id === project.owner.id && (
          <section className="row between center wrap gap-3"
                   style={{ paddingTop: 4, borderTop: "1px solid var(--line)" }}>
            <span className="faint" style={{ fontSize: ".79rem", maxWidth: "58ch" }}>
              Removing this project stops tracking it here. The repository is left
              alone unless you say otherwise.
            </span>
            <DeleteProject
              projectId={project.id}
              projectName={project.name}
              repoPath={project.repo?.path_with_namespace ?? null}
            />
          </section>
        )}
      </div>
    </>
  );
}
