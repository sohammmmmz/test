"""Creating a project, which means creating a repository.

The order below is not arbitrary — each step needs what the one before it
produced, and the first is the one that is easy to get wrong: the repository is
created *initialised*, because a GitLab project with no commits has no branches
either, and there is nothing to cut a member branch from.

Failures after the repository exists are recorded rather than raised. A project
whose repo was made but whose third member branch failed is a real project with
one thing to fix, not a request to throw away.
"""

from __future__ import annotations

import logging
import re

from django.conf import settings
from django.db import transaction
from django.utils.text import slugify

from gitlab_api.exceptions import GitLabError
from gitlab_api.gateway import service_client

from .models import Document, GitLabRepo, Project, ProjectMember

logger = logging.getLogger(__name__)

# GitLab branch names cannot carry spaces or most punctuation.
_UNSAFE_BRANCH = re.compile(r"[^a-zA-Z0-9._-]+")


class ProjectCreationError(Exception):
    """The repository could not be created, so there is no project."""


def branch_for(user) -> str:
    """The standing branch a member works on.

    Named from their GitLab handle so the branch is recognisable in GitLab's
    own UI by somebody who has never seen this tool.
    """
    handle = user.gitlab_username or user.username
    return f"dev/{_UNSAFE_BRANCH.sub('-', handle).strip('-.') or 'member'}"


def unique_slug(name: str) -> str:
    base = slugify(name)[:200] or "project"
    slug, n = base, 1
    while Project.objects.filter(slug=slug).exists():
        n += 1
        suffix = f"-{n}"
        slug = f"{base[: 200 - len(suffix)]}{suffix}"
    return slug


def _repo_fields(payload: dict) -> dict:
    namespace = payload.get("namespace") or {}
    return {
        "gitlab_project_id": payload["id"],
        "path_with_namespace": payload.get("path_with_namespace", ""),
        "name": payload.get("name", ""),
        "web_url": payload.get("web_url", "") or "",
        "http_url_to_repo": payload.get("http_url_to_repo", "") or "",
        "ssh_url_to_repo": payload.get("ssh_url_to_repo", "") or "",
        # A brand-new project can report default_branch as null.
        "default_branch": payload.get("default_branch") or settings.GITLAB_DEFAULT_BRANCH,
        "visibility": payload.get("visibility", "private"),
        "namespace_path": namespace.get("full_path", "") or "",
    }


def link_existing_repo(reference: str | int, *, client=None) -> dict:
    """Fetch a repository the owner picked, refusing one already spoken for.

    A repository backs exactly one project. Letting two projects share one would
    make every milestone and issue ambiguous the moment both were planned.
    """
    client = client or service_client()
    try:
        payload = client.get_project(reference)
    except GitLabError as exc:
        raise ProjectCreationError(
            f"That repository could not be read: {exc}. Check the path, and that "
            "GITLAB_SERVICE_TOKEN can see it."
        ) from exc

    taken = (
        GitLabRepo.objects.filter(gitlab_project_id=payload["id"])
        .select_related("project").first()
    )
    if taken is not None:
        raise ProjectCreationError(
            f"{payload.get('path_with_namespace')} already backs the project "
            f"'{taken.project.name}'. A repository can only back one."
        )
    return payload


def create_project(*, name: str, owner, description: str = "", team=None,
                   member_users=(), status: str | None = None,
                   started_on=None, target_end_on=None,
                   repo_reference: str | int | None = None,
                   documentation_branch: str | None = None) -> tuple[Project, list[str]]:
    """Create the project and everything GitLab needs to back it.

    ``repo_reference`` links a repository that already exists; without it a new
    one is created. Returns the project and a list of warnings — things that did
    not work but did not invalidate the project.
    """
    client = service_client()
    warnings: list[str] = []
    slug = unique_slug(name)

    # 1. The repository. Linked if one was chosen, otherwise created —
    #    initialised, because a project with no commits has no branches and
    #    there would be nothing to cut a member branch from.
    if repo_reference:
        payload = link_existing_repo(repo_reference, client=client)
        created_by_app = False
    else:
        try:
            payload = client.create_project(
                name,
                path=slug,
                namespace_id=settings.GITLAB_GROUP_ID or None,
                description=description,
            )
        except GitLabError as exc:
            raise ProjectCreationError(
                f"GitLab would not create the repository: {exc}. "
                "A project with that path may already exist in the group."
            ) from exc
        created_by_app = True

    fields = _repo_fields(payload)

    with transaction.atomic():
        project = Project.objects.create(
            name=name, slug=slug, description=description, owner=owner, team=team,
            status=status or Project._meta.get_field("status").default,
            started_on=started_on, target_end_on=target_end_on,
        )
        GitLabRepo.objects.create(
            project=project,
            created_by_app=created_by_app,
            documentation_branch=(documentation_branch or "").strip(),
            **fields,
        )

    # 2 & 3. Members onto the repository, then a branch each.
    for user in member_users:
        warnings.extend(add_member(project, user, client=client))

    # 4. The documentation branch, created by the commit that writes its README
    #    so no empty branch is left behind if the call fails.
    try:
        ensure_documentation_branch(project, client=client)
    except GitLabError as exc:
        warnings.append(f"Documentation branch was not created: {exc}")

    logger.info("Created project %s backed by %s", project.name, fields["path_with_namespace"])
    return project, warnings


def add_member(project: Project, user, *, client=None) -> list[str]:
    """Put somebody on the project: GitLab membership, then their branch."""
    client = client or service_client()
    repo = project.repo
    warnings: list[str] = []

    member, _ = ProjectMember.objects.get_or_create(
        project=project, user=user,
        defaults={"branch_name": branch_for(user),
                  "access_level": settings.MEMBER_ACCESS_LEVEL},
    )

    if not user.gitlab_user_id:
        member.sync_error = "No GitLab account on file, so they cannot be added to the repository."
        member.save(update_fields=["sync_error"])
        warnings.append(f"{user.display_name} has no GitLab account linked.")
        return warnings

    try:
        client.add_member(
            repo.gitlab_project_id,
            user_id=user.gitlab_user_id,
            access_level=settings.MEMBER_ACCESS_LEVEL,
        )
    except GitLabError as exc:
        # Already a member is not a failure worth reporting.
        if getattr(exc, "status_code", None) != 409:
            warnings.append(f"Could not add {user.display_name} to the repository: {exc}")

    branch = member.branch_name or branch_for(user)
    try:
        if not client.branch_exists(repo.gitlab_project_id, branch):
            client.create_branch(repo.gitlab_project_id, branch=branch,
                                 ref=repo.default_branch)
        member.synced_to_gitlab = True
        member.sync_error = ""
    except GitLabError as exc:
        member.sync_error = str(exc)
        warnings.append(f"Could not create the branch {branch}: {exc}")

    member.branch_name = branch
    member.save(update_fields=["branch_name", "synced_to_gitlab", "sync_error"])
    return warnings


def remove_member(project: Project, user, *, client=None) -> None:
    """Take somebody off the project.

    Their branch is deliberately left in place — it may hold unmerged work, and
    deleting somebody's commits because they moved teams would be indefensible.
    """
    client = client or service_client()
    if user.gitlab_user_id:
        try:
            client.remove_member(project.repo.gitlab_project_id, user.gitlab_user_id)
        except GitLabError as exc:
            logger.warning("Could not remove %s from the repository: %s", user, exc)
    ProjectMember.objects.filter(project=project, user=user).delete()


def ensure_documentation_branch(project: Project, *, client=None) -> bool:
    """Make sure the documentation branch exists. True if it already did.

    An existing branch is used as it stands — a linked repository may already
    keep its docs somewhere, and rearranging somebody's repository to suit this
    tool would be the wrong way round.
    """
    client = client or service_client()
    repo = project.repo
    branch = repo.docs_branch

    if client.branch_exists(repo.gitlab_project_id, branch):
        if not repo.documentation_branch_ready:
            repo.documentation_branch_ready = True
            repo.save(update_fields=["documentation_branch_ready"])
        return True

    client.create_commit(
        repo.gitlab_project_id,
        branch=branch,
        commit_message=f"Create {branch} branch",
        actions=[{
            "action": "create",
            "file_path": "docs/README.md",
            "content": _docs_readme(project),
        }],
        start_branch=repo.default_branch,
    )
    repo.documentation_branch_ready = True
    repo.save(update_fields=["documentation_branch_ready"])
    return False


def _docs_readme(project: Project) -> str:
    return (
        f"# {project.name} — documentation\n\n"
        "Maintained from the project manager.\n\n"
        "- `docs/BRD.*` — business requirements document\n"
        "- `docs/TECHNICAL.*` — technical document\n"
    )


def delete_project(project: Project, *, delete_repository: bool = False) -> dict:
    """Remove the project. The repository survives unless explicitly asked for.

    Deleting somebody's code because they stopped tracking it here would be
    indefensible, so it takes a deliberate second decision.
    """
    from planning.models import Milestone, Task

    repo_path = project.repo.path_with_namespace if hasattr(project, "repo") else None
    removed = {
        "milestones": Milestone.objects.filter(project=project).count(),
        "tasks": Task.objects.filter(milestone__project=project).count(),
        "members": project.members.count(),
        "documents": project.documents.count(),
    }

    repository_error = ""
    repository_deleted = False
    if delete_repository and hasattr(project, "repo"):
        try:
            service_client().delete_project(project.repo.gitlab_project_id)
            repository_deleted = True
        except GitLabError as exc:
            # The project still goes, but say so plainly: silently keeping a
            # repository somebody asked to destroy is the worse surprise.
            logger.warning("Could not delete the repository %s: %s", repo_path, exc)
            repository_error = str(exc)

    project.delete()
    return {
        "removed": removed,
        "repository": repo_path,
        "repository_deleted": repository_deleted,
        "repository_error": repository_error,
    }
