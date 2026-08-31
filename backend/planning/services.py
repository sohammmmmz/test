"""Keeping milestones and tasks in step with GitLab.

Writes go upstream first and are mirrored locally on success, so this database
never claims something exists in GitLab that does not. Reads reconcile the
other way: opening a project re-reads GitLab, because someone editing an issue
in GitLab's own UI must not have their change silently overwritten.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.cache import claim, release
from gitlab_api.exceptions import GitLabError, GitLabNotFound
from gitlab_api.gateway import service_client

from .models import Issue, Milestone, Task

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
    """Closing the work item closes the line that pointed at it.

    ``closed_by`` is left null on purpose: nobody in this app performed this
    closing, GitLab did, and naming a person for it would be inventing a fact.
    """
    from daily.models import Todo

    from core.cache import SCOPES, bump

    closed = Todo.objects.filter(task=task, done_at__isnull=True).update(
        done_at=timezone.now()
    )
    if closed:
        # queryset.update() fires no post_save, so the signal that invalidates
        # the todo scope never runs. See core.invalidation.
        bump(SCOPES.TODOS)
    return closed


# ---------------------------------------------------------------------------
# Issues raised against a task
# ---------------------------------------------------------------------------


def _cross_reference(task: Task) -> str:
    """The line that makes an issue and its task findable from each other.

    A bare ``#iid`` in an issue description is how GitLab has always made
    cross-references, on every tier and every version back further than anything
    anybody is still running. That is the whole reason it is here rather than
    relying on the related-issues link: the link is the nicer artefact and the
    less dependable one — it is a separate endpoint, it needs both ends visible
    to the token, and its blocking variants are Premium. This works or the issue
    would not have been created at all.
    """
    return f"\n\n---\nRaised against #{task.gitlab_iid} · logged from Morning Ledger."


def log_issue(task: Task, *, title: str, description: str = "",
              severity: str = Issue.Severity.MEDIUM, reported_by=None,
              assignee=None) -> Issue:
    """Record something wrong with this task.

    Filed in GitLab when the task lives there, and here alone when it does not —
    a task on a project with no repository, or one whose own GitLab write never
    landed. The row is identical either way; only ``is_in_gitlab`` differs.

    When GitLab is meant to have it and refuses, this raises rather than quietly
    keeping a local copy. Falling back would leave two records of the same
    defect disagreeing about whether it exists, and the caller has somewhere
    better to put the failure: the browser holds the request and offers to send
    it again.
    """
    project = task.milestone.project
    repo = getattr(project, "repo", None)
    upstream = repo is not None and task.gitlab_iid is not None

    payload: dict = {}
    linked = False

    if upstream:
        client = _client()
        try:
            payload = client.create_issue(
                repo.gitlab_project_id,
                title=title,
                description=(description or "") + _cross_reference(task),
                milestone_id=task.milestone.gitlab_id,
                assignee_id=assignee.gitlab_user_id if assignee else None,
                labels=[f"severity::{severity}"] if severity else None,
            )
        except GitLabError as exc:
            raise PlanningError(f"GitLab would not create the issue: {exc}") from exc

        # Best effort, and genuinely optional — see link_issues. The description
        # already carries the reference, so a server that cannot do this loses
        # nothing a person would notice.
        try:
            client.link_issues(
                repo.gitlab_project_id,
                payload["iid"],
                target_project_id=repo.gitlab_project_id,
                target_iid=task.gitlab_iid,
            )
            linked = True
        except (GitLabError, KeyError) as exc:
            logger.info(
                "Issue %s filed but not formally linked to task %s: %s",
                payload.get("iid"), task.gitlab_iid, exc,
            )

    return Issue.objects.create(
        task=task,
        title=title,
        description=description or "",
        severity=severity,
        state=payload.get("state") or Issue.State.OPEN,
        reported_by=reported_by,
        assignee=assignee,
        gitlab_id=payload.get("id"),
        gitlab_iid=payload.get("iid"),
        web_url=payload.get("web_url", "") or "",
        is_linked=linked,
    )


def update_issue(issue: Issue, **fields) -> Issue:
    """Edit or resolve an issue, upstream first where there is an upstream."""
    repo = getattr(issue.task.milestone.project, "repo", None)

    if issue.is_in_gitlab and repo is not None:
        client = _client()
        upstream: dict = {}
        if "title" in fields:
            upstream["title"] = fields["title"]
        if "description" in fields:
            upstream["description"] = (fields["description"] or "") + _cross_reference(issue.task)
        if "assignee" in fields:
            upstream["assignee_id"] = (
                fields["assignee"].gitlab_user_id if fields["assignee"] else 0
            )
        if "state" in fields:
            # A verb, not a value: GitLab takes state_event=close|reopen.
            upstream["state_event"] = (
                "close" if fields["state"] == Issue.State.CLOSED else "reopen"
            )
        if upstream:
            try:
                client.update_issue(repo.gitlab_project_id, issue.gitlab_iid, **upstream)
            except GitLabError as exc:
                raise PlanningError(f"GitLab would not accept the change: {exc}") from exc

    for name, value in fields.items():
        setattr(issue, name, value)
    if "state" in fields:
        issue.closed_at = timezone.now() if fields["state"] == Issue.State.CLOSED else None
    issue.save()
    return issue


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------


def reconcile_project(project, *, force: bool = False) -> dict:
    """Re-read milestones and tasks from GitLab into this database.

    GitLab is authoritative: a task closed in its UI closes here, and the todo
    pointing at it is ticked off too.

    Everything filed under a milestone this project can see is read, whatever
    work item type it is. The milestone is the gate, not the type — see
    ``gitlab_api.client.list_tasks``.

    **Throttled unless forced.** This is two or more HTTP round trips to a
    server that may be across a VPN, and it used to run on every render of the
    project screen — which meant every small edit on that screen paid for it
    twice, once for the write and once for the re-render. Opening a project now
    asks for a reconcile at most once per ``RECONCILE_THROTTLE_SECONDS``; the
    Sync button passes ``force=True`` and always runs, because a person who
    presses Sync is entitled to know it actually synced.
    """
    repo = getattr(project, "repo", None)
    blank = {"milestones": 0, "tasks": 0, "todos_completed": 0, "read": 0,
             "skipped_no_milestone": 0, "skipped_unknown_milestone": 0,
             "unmatched_milestones": [], "types": {}}
    if repo is None:
        return blank

    if not force and not claim(f"reconcile:{project.pk}", settings.RECONCILE_THROTTLE_SECONDS):
        return {**blank, "skipped": True,
                "detail": "Reconciled moments ago; showing what was read then."}

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
        # Give the window back. A reconcile that failed should be retryable
        # straight away, not held off for another minute and a half by a claim
        # that bought nothing.
        release(f"reconcile:{project.pk}")
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
