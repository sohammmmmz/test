"""Keeping milestones and tasks in step with GitLab.

Writes go upstream first and are mirrored locally on success, so this database
never claims something exists in GitLab that does not. Reads reconcile the
other way: opening a project re-reads GitLab, because someone editing an issue
in GitLab's own UI must not have their change silently overwritten.
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from gitlab_api.exceptions import GitLabError, GitLabNotFound
from gitlab_api.gateway import service_client

from .models import Milestone, Task

logger = logging.getLogger(__name__)
User = get_user_model()


class PlanningError(Exception):
    """GitLab refused the change, so nothing was recorded here either."""


def _repo(project):
    repo = getattr(project, "repo", None)
    if repo is None:
        raise PlanningError("This project has no repository.")
    return repo


# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------


def _client():
    """The service credential, as a planning failure rather than a crash.

    ``service_client()`` raises when the token is missing, and it is normally
    called outside the try that guards the call it is for — so an unconfigured
    install answered every write with a 500 instead of saying which setting is
    missing.
    """
    try:
        return service_client()
    except GitLabError as exc:
        raise PlanningError(str(exc)) from exc


def create_milestone(project, *, title: str, description: str = "",
                     start_date=None, due_date=None) -> Milestone:
    repo = _repo(project)
    client = _client()

    try:
        payload = client.create_milestone(
            repo.gitlab_project_id, title=title, description=description,
            start_date=start_date, due_date=due_date,
        )
    except GitLabError as exc:
        raise PlanningError(f"GitLab would not create the milestone: {exc}") from exc

    return Milestone.objects.create(
        project=project,
        gitlab_id=payload.get("id"),
        gitlab_iid=payload.get("iid"),
        title=title,
        description=description,
        state=payload.get("state") or Milestone.State.ACTIVE,
        start_date=start_date,
        due_date=due_date,
        web_url=payload.get("web_url", "") or "",
    )


class InheritedMilestone(Exception):
    """A group milestone cannot be changed from inside one of its projects."""


def update_milestone(milestone: Milestone, **fields) -> Milestone:
    if milestone.is_inherited:
        raise InheritedMilestone(
            f"'{milestone.title}' belongs to a parent group. Edit it in GitLab, "
            "where the other projects using it can see the change."
        )
    repo = _repo(milestone.project)
    client = _client()

    upstream = {k: v for k, v in fields.items() if v is not None}
    if "state" in fields:
        upstream.pop("state", None)
        upstream["state_event"] = (
            "close" if fields["state"] == Milestone.State.CLOSED else "activate"
        )

    if milestone.gitlab_id:
        try:
            client.update_milestone(repo.gitlab_project_id, milestone.gitlab_id, **upstream)
        except GitLabNotFound:
            # Deleted in GitLab. Keeping our copy would be a lie.
            logger.warning("Milestone %s no longer exists in GitLab", milestone.gitlab_id)
            milestone.gitlab_id = None
        except GitLabError as exc:
            raise PlanningError(f"GitLab would not update the milestone: {exc}") from exc

    for key, value in fields.items():
        setattr(milestone, key, value)
    milestone.save()
    return milestone


def delete_milestone(milestone: Milestone) -> None:
    if milestone.is_inherited:
        raise InheritedMilestone(
            f"'{milestone.title}' belongs to a parent group. Deleting it here would "
            "take it from every project using it, so it is left to GitLab."
        )
    repo = _repo(milestone.project)
    if milestone.gitlab_id:
        try:
            service_client().delete_milestone(repo.gitlab_project_id, milestone.gitlab_id)
        except GitLabError as exc:
            logger.warning("Could not delete milestone in GitLab: %s", exc)
    milestone.delete()


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------


def create_task(milestone: Milestone, *, title: str, description: str = "",
                assignee=None, due_date=None, labels=None) -> Task:
    project = milestone.project
    repo = _repo(project)
    client = _client()

    try:
        payload = client.create_task(
            repo.gitlab_project_id,
            title=title,
            description=description,
            milestone_id=milestone.gitlab_id,
            assignee_id=assignee.gitlab_user_id if assignee else None,
            due_date=due_date,
            labels=labels,
        )
    except GitLabError as exc:
        raise PlanningError(f"GitLab would not create the task: {exc}") from exc

    return Task.objects.create(
        milestone=milestone,
        gitlab_id=payload.get("id"),
        gitlab_iid=payload.get("iid"),
        title=title,
        description=description,
        state=payload.get("state") or Task.State.OPEN,
        assignee=assignee,
        due_date=due_date,
        labels=list(labels or []),
        web_url=payload.get("web_url", "") or "",
    )


def update_task(task: Task, **fields) -> Task:
    """Edit a task, upstream first.

    Closing one ticks off any todo pointing at it — the two are the same piece
    of work, and marking it done in one place and not the other is how people
    stop trusting the todo list.
    """
    repo = _repo(task.project)
    client = _client()

    upstream: dict = {}
    if "title" in fields:
        upstream["title"] = fields["title"]
    if "description" in fields:
        upstream["description"] = fields["description"]
    if "due_date" in fields:
        upstream["due_date"] = fields["due_date"] or ""
    if "assignee" in fields:
        assignee = fields["assignee"]
        # GitLab clears an assignee with 0, not with null.
        upstream["assignee_id"] = assignee.gitlab_user_id if assignee else 0
    if "state" in fields:
        upstream["state_event"] = (
            "close" if fields["state"] == Task.State.CLOSED else "reopen"
        )

    if task.gitlab_iid and upstream:
        try:
            client.update_task(repo.gitlab_project_id, task.gitlab_iid, **upstream)
        except GitLabNotFound:
            logger.warning("Issue %s no longer exists in GitLab", task.gitlab_iid)
            task.gitlab_iid = None
        except GitLabError as exc:
            raise PlanningError(f"GitLab would not update the task: {exc}") from exc

    was_open = task.state == Task.State.OPEN
    for key, value in fields.items():
        setattr(task, key, value)
    if task.state == Task.State.CLOSED and was_open:
        task.closed_at = timezone.now()
    elif task.state == Task.State.OPEN:
        task.closed_at = None
    task.save()

    if task.state == Task.State.CLOSED and was_open:
        _complete_todos_for(task)
    return task


def _complete_todos_for(task: Task) -> int:
    """Closing the issue closes the line that pointed at it.

    This is the one closing nobody has to perform in the round: the evidence is
    in GitLab, so it needs no confirming. The claim is stamped alongside it so
    the todo does not read as closed by an owner who never saw it.
    """
    from daily.models import Todo

    from django.db.models import Value
    from django.db.models.functions import Coalesce

    now = timezone.now()
    return Todo.objects.filter(task=task, done_at__isnull=True).update(
        done_at=now,
        # Coalesce, not a plain assignment: if the person already said it was
        # finished, that is when they said it, not now.
        claimed_at=Coalesce("claimed_at", Value(now)),
    )


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------


def reconcile_project(project) -> dict:
    """Re-read milestones and tasks from GitLab into this database.

    Run when a project is opened. GitLab is authoritative: a task closed in its
    UI closes here, and the todo pointing at it is ticked off too.

    Only work items of type *task* are read. Issues somebody opened by hand are
    left entirely alone — they are not planning artefacts and this tool has no
    business rewriting them.
    """
    repo = getattr(project, "repo", None)
    blank = {"milestones": 0, "tasks": 0, "todos_completed": 0, "read": 0,
             "skipped_no_milestone": 0, "skipped_unknown_milestone": 0,
             "unmatched_milestones": [], "types": {}}
    if repo is None:
        return blank

    try:
        # service_client() rather than _client(): this is already inside the
        # try, and it raises GitLabError, which is what is caught here. A
        # reconcile that cannot reach GitLab is a thing to report, not a server
        # error — Sync calls this for every project at once, so one unconfigured
        # install would otherwise be a screen of 500s.
        client = service_client()
        milestone_payloads = client.list_milestones(repo.gitlab_project_id)
        issue_payloads = client.list_tasks(repo.gitlab_project_id)
    except GitLabError as exc:
        logger.warning("Could not reconcile %s: %s", project.name, exc)
        return {**blank, "error": str(exc)}

    by_gitlab_id: dict[int, Milestone] = {}
    for payload in milestone_payloads:
        milestone, _ = Milestone.objects.update_or_create(
            project=project,
            gitlab_id=payload["id"],
            defaults={
                "gitlab_iid": payload.get("iid"),
                "title": payload.get("title", ""),
                "description": payload.get("description", "") or "",
                "state": payload.get("state") or Milestone.State.ACTIVE,
                "start_date": parse_date(payload["start_date"]) if payload.get("start_date") else None,
                "due_date": parse_date(payload["due_date"]) if payload.get("due_date") else None,
                "web_url": payload.get("web_url", "") or "",
                # A group milestone carries group_id where a project milestone
                # carries project_id. It can hold this project's work but lives
                # somewhere this project's endpoints cannot reach.
                "is_inherited": bool(payload.get("group_id")),
            },
        )
        by_gitlab_id[payload["id"]] = milestone

    # A GitLab user id is the only reliable way back to a person here; commit
    # emails and display names are not.
    users = {
        u.gitlab_user_id: u
        for u in User.objects.exclude(gitlab_user_id__isnull=True)
    }

    todos_completed = 0
    task_count = 0
    # What was seen but not kept. A sync that silently drops everything is
    # indistinguishable from a sync that found nothing, and the difference is
    # the whole diagnosis.
    skipped_no_milestone = 0
    skipped_unknown_milestone = 0
    unmatched: dict[int, str] = {}
    types_seen: dict[str, int] = {}

    for payload in issue_payloads:
        kind = payload.get("issue_type") or "unknown"
        types_seen[kind] = types_seen.get(kind, 0) + 1

        milestone_payload = payload.get("milestone") or {}
        if not milestone_payload:
            # Filed under nothing. It stays in GitLab untouched rather than
            # being invented a milestone here.
            skipped_no_milestone += 1
            continue

        milestone = by_gitlab_id.get(milestone_payload.get("id"))
        if milestone is None:
            # Filed under a milestone this project cannot see — most often a
            # group milestone on a server that does not return ancestors.
            skipped_unknown_milestone += 1
            unmatched.setdefault(
                milestone_payload.get("id"),
                milestone_payload.get("title", "") or str(milestone_payload.get("id")),
            )
            continue

        assignee_payload = payload.get("assignee") or {}
        state = payload.get("state") or Task.State.OPEN

        task, _ = Task.objects.update_or_create(
            milestone=milestone,
            gitlab_id=payload["id"],
            defaults={
                "gitlab_iid": payload.get("iid"),
                "title": payload.get("title", ""),
                "description": payload.get("description", "") or "",
                "state": state,
                "work_item_type": payload.get("issue_type") or "issue",
                "assignee": users.get(assignee_payload.get("id")),
                "due_date": parse_date(payload["due_date"]) if payload.get("due_date") else None,
                "labels": payload.get("labels") or [],
                "web_url": payload.get("web_url", "") or "",
                "closed_at": (
                    parse_datetime(payload["closed_at"]) if payload.get("closed_at") else None
                ),
            },
        )
        task_count += 1
        if state == Task.State.CLOSED:
            todos_completed += _complete_todos_for(task)

    result = {
        "milestones": len(by_gitlab_id),
        "tasks": task_count,
        "todos_completed": todos_completed,
        # Diagnostics. Cheap to carry, and the only way a sync that reads sixty
        # work items and keeps none can say so.
        "read": len(issue_payloads),
        "skipped_no_milestone": skipped_no_milestone,
        "skipped_unknown_milestone": skipped_unknown_milestone,
        "unmatched_milestones": sorted(unmatched.values())[:8],
        "types": types_seen,
    }
    if skipped_no_milestone or skipped_unknown_milestone:
        logger.info(
            "%s: read %s work items, kept %s (%s had no milestone, %s had one this "
            "project cannot see: %s)",
            project.name, len(issue_payloads), task_count,
            skipped_no_milestone, skipped_unknown_milestone,
            ", ".join(result["unmatched_milestones"]) or "—",
        )
    return result
