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
def ensure_day(user, day: date) -> list[Todo]:
    """Materialise ``user``'s list for ``day``, carrying forward what is unfinished.

    Idempotent: asking twice does not duplicate anything, which matters because
    every screen that shows a day calls this.
    """
    existing = list(Todo.objects.filter(user=user, date=day).select_related("task"))
    if existing:
        return existing

    if not is_working_day(day):
        # Nobody is expected to work, so nothing is carried onto it. A todo
        # added by hand on a Saturday is still perfectly allowed.
        return []

    previous = previous_working_day(day)
    if previous is None:
        return []

    unfinished = (
        Todo.objects.filter(user=user, date=previous, done_at__isnull=True)
        .select_related("task")
        .order_by("-carry_count", "id")
    )

    carried = []
    for todo in unfinished:
        # A todo whose task was closed elsewhere is finished, not carried.
        if todo.task and todo.task.state == Task.State.CLOSED:
            continue
        # A line the person already said was finished carries the claim with
        # it, and does not age: it is sitting on the owner's review, not on
        # them, so counting another day against it would blame the wrong end.
        claimed = todo.claimed_at is not None
        carried.append(
            Todo(
                user=user,
                date=day,
                title=todo.title,
                notes=todo.notes,
                task=todo.task,
                source=TodoSource.CARRIED,
                carried_from=todo,
                first_added_on=todo.first_added_on or todo.date,
                carry_count=todo.carry_count if claimed else todo.carry_count + 1,
                claimed_at=todo.claimed_at,
                claimed_by=todo.claimed_by,
                created_by=todo.created_by,
            )
        )

    if carried:
        Todo.objects.bulk_create(carried)
    return list(Todo.objects.filter(user=user, date=day).select_related("task"))


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
            "claimed": sum(1 for t in todos if t.is_claimed),
            "carried": sum(1 for t in todos if t.carry_count > 0),
            "stale": sum(1 for t in todos if t.is_stale),
        },
    }


def pending_for(user, day: date) -> list[Todo]:
    """What is on the list and nobody has even claimed to have finished."""
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

    rows = []
    for user in team_members(team):
        todos = ensure_day(user, day)
        pending = [t for t in todos if t.status == "open"]
        claimed = [t for t in todos if t.is_claimed]
        closed = [t for t in todos if t.is_done]
        rows.append({
            "user": user,
            "note": notes.get(user.id),
            "pending": pending,
            "claimed": claimed,
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
