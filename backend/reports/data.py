"""Gathering a report.

One place builds the numbers; the workbook and the on-screen preview both read
what it returns. Two code paths producing "the same" report is how a spreadsheet
ends up disagreeing with the screen it was exported from, and the spreadsheet is
the copy that gets forwarded.

Everything here is plain dicts and primitives — no querysets, no model instances
— so the workbook writer never has to reach back into the database and cannot
accidentally widen the scope of what somebody is allowed to see.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from daily.models import Meeting, MeetingStatus, Todo
from daily.services import ensure_day, is_working_day
from planning.models import Milestone, Task
from projects.models import Project, ProjectMember
from teams.models import TeamMembership

User = get_user_model()

DAILY = "daily"
WEEKLY = "weekly"


@dataclass(frozen=True)
class Period:
    """The window a report covers, and what to call it."""

    kind: str
    start: date
    end: date

    @property
    def days(self) -> list[date]:
        span = (self.end - self.start).days
        return [self.start + timedelta(days=n) for n in range(span + 1)]

    @property
    def label(self) -> str:
        if self.kind == DAILY:
            return self.start.strftime("%A %d %B %Y")
        return f"{self.start.strftime('%d %b')} – {self.end.strftime('%d %b %Y')}"

    @property
    def slug(self) -> str:
        if self.kind == DAILY:
            return self.start.isoformat()
        return f"{self.start.isoformat()}_to_{self.end.isoformat()}"


def resolve_period(kind: str, anchor: date | None = None) -> Period:
    """Work out the window from a kind and a date inside it.

    A weekly report runs Monday to Sunday but never past today: a Wednesday
    export that claims to cover Friday would show three days of zeros and read
    as the team having stopped.
    """
    today = timezone.localdate()
    anchor = anchor or today
    if kind == WEEKLY:
        start = anchor - timedelta(days=anchor.weekday())
        end = min(start + timedelta(days=6), max(today, start))
        return Period(WEEKLY, start, end)
    return Period(DAILY, anchor, anchor)


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------


def _projects_for(owner):
    return (
        Project.objects.filter(owner=owner)
        .select_related("repo", "team", "owner")
        .prefetch_related("members__user", "documents")
        .order_by("name")
    )


def _people_for(owner) -> list:
    """Everyone the owner is responsible for, themselves included."""
    ids = set(
        TeamMembership.objects.filter(team__owner=owner, left_on__isnull=True)
        .values_list("user_id", flat=True)
    )
    ids.add(owner.id)
    return list(User.objects.filter(pk__in=ids).order_by("first_name", "username"))


# ---------------------------------------------------------------------------
# The sheets
# ---------------------------------------------------------------------------


def _project_rows(owner, period: Period) -> list[dict]:
    rows = []
    for project in _projects_for(owner):
        progress = project.progress()
        readiness = project.readiness()
        milestones = Milestone.objects.filter(project=project)
        tasks = Task.objects.filter(milestone__project=project)

        rows.append({
            "name": project.name,
            "status": project.get_status_display(),
            "is_active": project.is_in_flight,
            "phase": project.phase_index + 1,
            "phase_of": project.phase_count,
            "repository": project.repo.path_with_namespace if hasattr(project, "repo") else "",
            "repo_url": project.repo.web_url if hasattr(project, "repo") else "",
            "team": project.team.name if project.team else "—",
            "owner": project.owner.display_name,
            "people": project.members.count(),
            "milestones": milestones.count(),
            "milestones_closed": milestones.filter(state=Milestone.State.CLOSED).count(),
            "tasks": tasks.count(),
            "tasks_done": progress["completed_tasks"],
            "percent": progress["percent"],
            "overdue_milestones": progress["overdue_milestones"],
            "is_slipping": progress["is_slipping"],
            "next_milestone": progress["next_milestone"] or "—",
            "next_due": progress["next_due_date"],
            "started_on": project.started_on,
            "target_end_on": project.target_end_on,
            "setup": f"{readiness['passed']}/{readiness['total']}",
            "missing": ", ".join(c["label"] for c in readiness["checks"] if not c["passed"]) or "—",
            # Movement inside the window, which is the whole reason a report
            # covers a period rather than a moment.
            "closed_in_period": tasks.filter(
                state=Task.State.CLOSED,
                closed_at__date__gte=period.start,
                closed_at__date__lte=period.end,
            ).count(),
        })
    return rows


def _bandwidth(load: int, overdue: int) -> tuple[int, str]:
    """Load as a percentage of what one person comfortably holds, and a word.

    Overdue work counts double. Something a week late is not the same weight as
    something due on Friday, and a straight count of open items says they are.
    """
    capacity = max(settings.CAPACITY_OPEN_ITEMS, 1)
    weighted = load + overdue
    percent = round(weighted / capacity * 100)
    if percent == 0:
        return percent, "Free"
    if percent <= 60:
        return percent, "Spare capacity"
    if percent <= 100:
        return percent, "Steady"
    if percent <= 150:
        return percent, "Full"
    return percent, "Over capacity"


def _people_rows(owner, period: Period) -> list[dict]:
    rows = []
    for person in _people_for(owner):
        # Today's list is materialised on read, so asking for it is also what
        # creates it — the same call every screen makes.
        today_todos = ensure_day(person, timezone.localdate())
        open_todos = [t for t in today_todos if t.status == "open"]

        window = Todo.objects.filter(user=person, date__gte=period.start, date__lte=period.end)
        window_rows = list(window)

        open_tasks = Task.objects.filter(assignee=person, state=Task.State.OPEN)
        overdue = open_tasks.filter(due_date__lt=timezone.localdate()).count()
        load = open_tasks.count() + len(open_todos)
        percent, verdict = _bandwidth(load, overdue)

        # Scoped to this owner's projects. Somebody staffed on another owner's
        # repository is real, but naming it here would leak a roster this report
        # has no business carrying.
        projects = list(
            ProjectMember.objects.filter(user=person, project__owner=owner)
            .select_related("project")
            .order_by("project__name")
        )

        rows.append({
            "name": person.display_name,
            "gitlab_username": person.gitlab_username or person.username,
            "department": person.get_department_display() if person.department else "—",
            "job_title": person.job_title or "—",
            "role": "Owner" if person.is_owner else "Member",
            "projects": len(projects),
            "project_names": ", ".join(p.project.name for p in projects) or "—",
            "open_tasks": open_tasks.count(),
            "overdue_tasks": overdue,
            "tasks_closed_in_period": Task.objects.filter(
                assignee=person, state=Task.State.CLOSED,
                closed_at__date__gte=period.start, closed_at__date__lte=period.end,
            ).count(),
            "todos_open_today": len(open_todos),
            "todos_in_period": len(window_rows),
            "todos_closed": sum(1 for t in window_rows if t.is_done),
            "todos_awaiting": sum(1 for t in window_rows if t.is_claimed),
            "todos_carrying": sum(1 for t in today_todos if t.carry_count > 0),
            "todos_stale": sum(1 for t in open_todos if t.is_stale),
            "load": load,
            "bandwidth_percent": percent,
            "bandwidth": verdict,
        })
    # Heaviest first: the person about to drop something should not be somewhere
    # down an alphabetical list.
    rows.sort(key=lambda r: (-r["bandwidth_percent"], -r["overdue_tasks"], r["name"]))
    return rows


def _assignment_rows(owner, period: Period) -> list[dict]:
    """Who is working where, one row per person per project."""
    rows = []
    for member in (
        ProjectMember.objects.filter(project__owner=owner)
        .select_related("user", "project")
        .order_by("project__name", "user__first_name")
    ):
        tasks = Task.objects.filter(
            milestone__project=member.project, assignee=member.user
        )
        rows.append({
            "project": member.project.name,
            "project_status": member.project.get_status_display(),
            "person": member.user.display_name,
            "department": (
                member.user.get_department_display() if member.user.department else "—"
            ),
            "branch": member.branch_name,
            "on_gitlab": "synced" if member.synced_to_gitlab else "not synced",
            "open_tasks": tasks.filter(state=Task.State.OPEN).count(),
            "overdue_tasks": tasks.filter(
                state=Task.State.OPEN, due_date__lt=timezone.localdate()
            ).count(),
            "closed_in_period": tasks.filter(
                state=Task.State.CLOSED,
                closed_at__date__gte=period.start, closed_at__date__lte=period.end,
            ).count(),
        })
    return rows


def _milestone_rows(owner, period: Period) -> list[dict]:
    rows = []
    for milestone in (
        Milestone.objects.filter(project__owner=owner)
        .select_related("project")
        .order_by("due_date", "project__name")
    ):
        progress = milestone.progress()
        rows.append({
            "project": milestone.project.name,
            "milestone": milestone.title,
            "state": milestone.get_state_display(),
            "start_date": milestone.start_date,
            "due_date": milestone.due_date,
            "days_remaining": milestone.days_remaining,
            "is_overdue": milestone.is_overdue,
            "tasks": progress["total"],
            "tasks_done": progress["done"],
            "percent": progress["percent"],
            "closed_in_period": Task.objects.filter(
                milestone=milestone, state=Task.State.CLOSED,
                closed_at__date__gte=period.start, closed_at__date__lte=period.end,
            ).count(),
        })
    return rows


def _activity_rows(owner, period: Period) -> list[dict]:
    """Day by day through the window.

    A weekly total hides the shape of the week. Four quiet days and one where
    everything closed is a different week from five even ones, and only one of
    them is a working rhythm.
    """
    person_objects = _people_for(owner)
    rows = []
    for day in period.days:
        todos = Todo.objects.filter(user__in=person_objects, date=day)
        rows.append({
            "date": day,
            "weekday": day.strftime("%A"),
            "is_working_day": is_working_day(day),
            "todos": todos.count(),
            "closed": todos.filter(done_at__isnull=False).count(),
            "awaiting": todos.filter(
                done_at__isnull=True, claimed_at__isnull=False
            ).count(),
            "still_open": todos.filter(done_at__isnull=True, claimed_at__isnull=True).count(),
            "tasks_closed": Task.objects.filter(
                milestone__project__owner=owner,
                state=Task.State.CLOSED, closed_at__date=day,
            ).count(),
            "meetings": Meeting.objects.filter(
                team__owner=owner, date=day, status=MeetingStatus.COMPLETED
            ).count(),
        })
    return rows


# ---------------------------------------------------------------------------
# The whole thing
# ---------------------------------------------------------------------------


def build_report(owner, kind: str, anchor: date | None = None) -> dict:
    """Everything one report contains, ready to render or serialise."""
    period = resolve_period(kind, anchor)

    projects = _project_rows(owner, period)
    people = _people_rows(owner, period)
    assignments = _assignment_rows(owner, period)
    milestones = _milestone_rows(owner, period)
    activity = _activity_rows(owner, period)

    over = [p for p in people if p["bandwidth_percent"] > 100]
    idle = [p for p in people if p["bandwidth_percent"] == 0]

    summary = {
        "generated_at": timezone.now(),
        "generated_by": owner.display_name,
        "kind": period.kind,
        "label": period.label,
        "start": period.start,
        "end": period.end,
        "projects": len(projects),
        "active_projects": sum(1 for p in projects if p["is_active"]),
        "slipping": sum(1 for p in projects if p["is_slipping"]),
        "not_ready": sum(1 for p in projects if p["missing"] != "—"),
        "people": len(people),
        "over_capacity": len(over),
        "idle": len(idle),
        "open_tasks": sum(p["open_tasks"] for p in people),
        "overdue_tasks": sum(p["overdue_tasks"] for p in people),
        "tasks_closed": sum(p["closed_in_period"] for p in projects),
        "todos_closed": sum(a["closed"] for a in activity),
        "todos_awaiting": sum(a["awaiting"] for a in activity),
        "meetings_held": sum(a["meetings"] for a in activity),
        "capacity_basis": settings.CAPACITY_OPEN_ITEMS,
    }

    return {
        "period": period,
        "summary": summary,
        "projects": projects,
        "people": people,
        "assignments": assignments,
        "milestones": milestones,
        "activity": activity,
    }


def filename_for(period: Period) -> str:
    return f"morning-ledger-{period.kind}-{period.slug}.xlsx"
