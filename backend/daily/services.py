"""Building the working day.

There is no scheduled job here on purpose. A cron that builds tomorrow's todo
lists is a cron that can silently not run, and the failure shows up as everyone
having an empty morning. Instead the day is materialised the first time anyone
asks for it — opening the meeting, or a member opening their own list — which
cannot be missed and needs no worker.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.cache import SCOPES, bump
from planning.models import Task

from .models import Meeting, MeetingNote, MeetingStatus, Todo, TodoSource

# How far back to look for the previous working day before giving up. Covers a
# long shutdown without looping forever on a misconfigured week.
MAX_LOOKBACK_DAYS = 30


def working_weekdays() -> set[int]:
    return {int(d) for d in settings.WORKING_WEEKDAYS}


def is_working_day(day: date) -> bool:
    return day.weekday() in working_weekdays()


def previous_working_day(day: date) -> date | None:
    """The last day work was expected before ``day``.

    Monday carries Friday's unfinished list, not three days of it.
    """
    weekdays = working_weekdays()
    if not weekdays:
        return None
    cursor = day - timedelta(days=1)
    for _ in range(MAX_LOOKBACK_DAYS):
        if cursor.weekday() in weekdays:
            return cursor
        cursor -= timedelta(days=1)
    return None


@transaction.atomic
def _carry_rows(user, day: date, unfinished) -> list[Todo]:
    """The rows that yesterday's unfinished work becomes today.

    Built rather than saved, so the caller decides whether that is one insert or
    one per person. Shared by ``ensure_day`` and ``ensure_days`` so the rules
    about what carries — and what it costs the person when it does — are written
    once.
    """
    rows = []
    for todo in unfinished:
        # A todo whose task was closed elsewhere is finished, not carried.
        if todo.task and todo.task.state == Task.State.CLOSED:
            continue
        rows.append(
            Todo(
                user=user,
                date=day,
                title=todo.title,
                notes=todo.notes,
                task=todo.task,
                source=TodoSource.CARRIED,
                carried_from=todo,
                first_added_on=todo.first_added_on or todo.date,
                carry_count=todo.carry_count + 1,
                created_by=todo.created_by,
            )
        )
    return rows


def ensure_days(users, day: date) -> dict[int, list[Todo]]:
    """``ensure_day`` for a group of people, in a fixed number of queries.

    The overview and the meeting board both need everybody's list at once, and
    calling ``ensure_day`` in a loop cost several queries per person on every
    render — on a team of twelve that is dozens of round trips to Postgres for a
    screen whose answer is two ``WHERE date = ... AND user_id IN (...)``.

    Worth noting that a person with genuinely nothing on today is not
    materialised — there is no row to find — so their carry-forward lookup runs
    again on every render. That is why it is the *bulk* lookup that matters
    here and not just the first-of-the-day one.
    """
    users = list(users)
    by_user: dict[int, list[Todo]] = {u.id: [] for u in users}
    if not users:
        return by_user

    for todo in (
        Todo.objects.filter(user_id__in=list(by_user), date=day)
        .select_related("task")
        .order_by("id")
    ):
        by_user[todo.user_id].append(todo)

    missing = [u for u in users if not by_user[u.id]]
    # Nobody is expected to work, so nothing is carried onto it. A todo added by
    # hand on a Saturday is still perfectly allowed.
    if not missing or not is_working_day(day):
        return by_user
    previous = previous_working_day(day)
    if previous is None:
        return by_user

    missing_ids = [u.id for u in missing]
    unfinished: dict[int, list[Todo]] = {uid: [] for uid in missing_ids}
    for todo in (
        Todo.objects.filter(user_id__in=missing_ids, date=previous, done_at__isnull=True)
        .select_related("task")
        .order_by("-carry_count", "id")
    ):
        unfinished[todo.user_id].append(todo)

    carried = []
    for user in missing:
        carried.extend(_carry_rows(user, day, unfinished[user.id]))
    if not carried:
        return by_user

    Todo.objects.bulk_create(carried)
    # bulk_create fires no post_save, so the invalidation wired to that signal
    # never runs. Bumping by hand here is the price of the one insert.
    bump(SCOPES.TODOS)

    for todo in (
        Todo.objects.filter(user_id__in=missing_ids, date=day)
        .select_related("task")
        .order_by("id")
    ):
        by_user[todo.user_id].append(todo)
    return by_user


def ensure_day(user, day: date) -> list[Todo]:
    """Materialise ``user``'s list for ``day``, carrying forward what is unfinished.

    Idempotent: asking twice does not duplicate anything, which matters because
    every screen that shows a day calls this.
    """
    existing = list(Todo.objects.filter(user=user, date=day).select_related("task"))
    if existing:
        return existing

    if not is_working_day(day):
        return []

    previous = previous_working_day(day)
    if previous is None:
        return []

    unfinished = (
        Todo.objects.filter(user=user, date=previous, done_at__isnull=True)
        .select_related("task")
        .order_by("-carry_count", "id")
    )

    carried = _carry_rows(user, day, unfinished)
    if carried:
        Todo.objects.bulk_create(carried)
        bump(SCOPES.TODOS)  # see ensure_days: bulk_create fires no signals
    return list(Todo.objects.filter(user=user, date=day).select_related("task"))


def attach_issue_counts(todos) -> None:
    """Hang each todo's open-issue count on it, in one query for the lot.

    An issue can be raised against the todo itself or against the planned task
    behind it, and both belong on the line — from the person's point of view it
    is one piece of work with one set of problems. Counted with ``distinct`` so
    an issue carrying both does not appear twice.

    Set on the instances rather than fetched by the serializer, because the
    serializer would ask once per row and a day is ten or twenty rows.
    """
    from django.db.models import Count, Q

    from planning.models import Issue

    todos = [t for t in todos if t.pk]
    if not todos:
        return
    for todo in todos:
        todo.open_issue_count = 0

    ids = [t.pk for t in todos]
    task_ids = {t.task_id for t in todos if t.task_id}

    counts: dict[int, int] = {}
    for row in (
        Issue.objects.filter(state=Issue.State.OPEN)
        .filter(Q(todo_id__in=ids) | Q(task_id__in=task_ids))
        .values("id", "todo_id", "task_id")
    ):
        for todo in todos:
            if row["todo_id"] == todo.pk or (
                todo.task_id and row["task_id"] == todo.task_id
            ):
                counts[todo.pk] = counts.get(todo.pk, 0) + 1
                break

    for todo in todos:
        todo.open_issue_count = counts.get(todo.pk, 0)


def suggestions_for(user, day: date, *, limit: int = 8) -> list[Task]:
    """Open GitLab tasks worth putting on this person's list today.

    Soonest due first, overdue included, and anything already on today's list
    is left out — offering somebody a task they are visibly working on is
    noise.
    """
    already = set(
        Todo.objects.filter(user=user, date=day, task__isnull=False)
        .values_list("task_id", flat=True)
    )
    return list(
        Task.objects.filter(assignee=user, state=Task.State.OPEN)
        .exclude(pk__in=already)
        .select_related("milestone__project")
        .order_by(
            models_ordering_due_first(), "-milestone__due_date", "id"
        )[:limit]
    )


def models_ordering_due_first():
    """Order by due date with nulls last, portably."""
    from django.db.models import F

    return F("due_date").asc(nulls_last=True)


def day_view(user, day: date) -> dict:
    """Everything one person's day is made of."""
    todos = ensure_day(user, day)
    attach_issue_counts(todos)
    suggestions = suggestions_for(user, day)
    open_tasks = (
        Task.objects.filter(assignee=user, state=Task.State.OPEN)
        .select_related("milestone__project")
        .order_by(models_ordering_due_first())
    )

    return {
        "date": day,
        "is_working_day": is_working_day(day),
        "todos": todos,
        "suggestions": suggestions,
        "open_tasks": list(open_tasks),
        "counts": {
            "total": len(todos),
            "done": sum(1 for t in todos if t.is_done),
            "carried": sum(1 for t in todos if t.carry_count > 0),
            "stale": sum(1 for t in todos if t.is_stale),
        },
    }


def pending_for(user, day: date) -> list[Todo]:
    """What is still open on this person's list."""
    return [t for t in ensure_day(user, day) if t.status == "open"]


# ---------------------------------------------------------------------------
# The meeting
# ---------------------------------------------------------------------------


def team_members(team) -> list:
    """Everyone in the round: the roster, and the owner.

    The owner is a working tech lead and carries todos too, so they take a turn
    like anybody else — they are placed last, because a lead who reviews
    themselves first tends to run out of meeting.
    """
    members = [m.user for m in team.roster()]
    if team.owner_id not in {m.id for m in members}:
        members.append(team.owner)
    return members


@transaction.atomic
def get_or_create_meeting(team, day: date, owner) -> Meeting:
    meeting, created = Meeting.objects.get_or_create(
        team=team, date=day, defaults={"owner": owner}
    )
    if created:
        MeetingNote.objects.bulk_create(
            [MeetingNote(meeting=meeting, user=user) for user in team_members(team)],
            ignore_conflicts=True,
        )
    return meeting


def last_meeting_for(team, user, before: date) -> dict | None:
    """What was said about this person the last time the team met.

    The owner runs the same round every morning, and the question they cannot
    answer from memory by Thursday is "what did we agree with them on Tuesday,
    and did it happen?". So this carries three things: the note taken then, the
    lines that were on the list that day, and how many of them closed.
    """
    previous = (
        Meeting.objects.filter(team=team, date__lt=before)
        .exclude(status=MeetingStatus.NOT_STARTED)
        .order_by("-date")
        .first()
    )
    if previous is None:
        return None

    note = previous.notes.filter(user=user).first()
    todos = list(
        Todo.objects.filter(user=user, date=previous.date).select_related("task")
    )
    return {
        "date": previous.date,
        "attended": note.attended if note else True,
        "blockers": note.blockers if note else "",
        "notes": note.notes if note else "",
        "todos": todos,
        "total": len(todos),
        "closed": sum(1 for t in todos if t.is_done),
        "still_open": sum(1 for t in todos if t.status == "open"),
        "days_ago": (before - previous.date).days,
    }


def meeting_board(team, day: date, owner) -> dict:
    """The pre-meeting picture: everyone's day, side by side.

    This is what the screen opens on. The round is a decision-making tool; the
    board is how the owner walks in already knowing where the trouble is.

    The three lists are kept apart rather than sorted into done and not-done,
    because the middle one is the interesting one: work the person says is
    finished and nobody has confirmed. That is precisely what the round exists
    to settle.
    """
    meeting = get_or_create_meeting(team, day, owner)
    notes = {n.user_id: n for n in meeting.notes.select_related("user")}

    people = team_members(team)
    days = ensure_days(people, day)
    attach_issue_counts([t for rows in days.values() for t in rows])

    rows = []
    for user in people:
        todos = days[user.id]
        pending = [t for t in todos if t.status == "open"]
        closed = [t for t in todos if t.is_done]
        rows.append({
            "user": user,
            "note": notes.get(user.id),
            "pending": pending,
            "done": closed,
            "suggestions": suggestions_for(user, day),
            "stale_count": sum(1 for t in pending if t.is_stale),
            "overdue_tasks": list(
                Task.objects.filter(
                    assignee=user, state=Task.State.OPEN, due_date__lt=day
                ).select_related("milestone__project")[:5]
            ),
            "last_meeting": last_meeting_for(team, user, day),
            "is_owner": user.id == team.owner_id,
        })

    return {"meeting": meeting, "rows": rows}


@transaction.atomic
def start_meeting(meeting: Meeting) -> Meeting:
    if meeting.status == MeetingStatus.NOT_STARTED:
        meeting.status = MeetingStatus.IN_PROGRESS
        meeting.started_at = timezone.now()
        meeting.current_index = 0
        meeting.save(update_fields=["status", "started_at", "current_index"])
    return meeting


@transaction.atomic
def advance_meeting(meeting: Meeting, *, index: int | None = None) -> Meeting:
    total = len(team_members(meeting.team))
    nxt = meeting.current_index + 1 if index is None else index
    meeting.current_index = max(0, min(nxt, max(total - 1, 0)))
    meeting.save(update_fields=["current_index"])
    return meeting


@transaction.atomic
def complete_meeting(meeting: Meeting, *, summary: str = "") -> Meeting:
    meeting.status = MeetingStatus.COMPLETED
    meeting.completed_at = timezone.now()
    if summary:
        meeting.summary = summary
    meeting.save(update_fields=["status", "completed_at", "summary"])
    return meeting
