"""Todos, and the morning meeting that sets them."""

from datetime import date as date_cls

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from core.cache import SCOPES
from core.http import cached_read

from accounts.permissions import IsOwner
from accounts.serializers import UserSerializer
from planning.models import Task
from planning.serializers import TaskSerializer
from teams.models import Team, TeamMembership

from .models import Meeting, MeetingNote, Todo, TodoSource
from .serializers import MeetingSerializer, TodoSerializer, TodoWriteSerializer
from .services import (
    advance_meeting,
    complete_meeting,
    day_view,
    ensure_day,
    get_or_create_meeting,
    meeting_board,
    start_meeting,
    team_members,
)

User = get_user_model()


def _parse_date(request, param: str = "date") -> date_cls:
    raw = request.query_params.get(param) or request.data.get(param)
    if raw:
        parsed = date_cls.fromisoformat(str(raw)[:10])
        return parsed
    return timezone.localdate()


def _may_see(actor, subject) -> bool:
    """An owner may see anyone on a team they own; everyone may see themselves."""
    if actor.id == subject.id:
        return True
    if not actor.is_owner:
        return False
    return TeamMembership.objects.filter(
        team__owner=actor, user=subject, left_on__isnull=True
    ).exists()


# ---------------------------------------------------------------------------
# One person's day
# ---------------------------------------------------------------------------


@api_view(["GET"])
@cached_read("my-day", (SCOPES.TODOS, SCOPES.PLAN, SCOPES.PEOPLE), "CACHE_TTL_DAY")
def my_day(request):
    """Today's list, the suggestions behind it, and the tasks it came from."""
    day = _parse_date(request)
    data = day_view(request.user, day)
    return Response({
        "date": day,
        "is_working_day": data["is_working_day"],
        "counts": data["counts"],
        "todos": TodoSerializer(data["todos"], many=True).data,
        "suggestions": TaskSerializer(data["suggestions"], many=True).data,
        "open_tasks": TaskSerializer(data["open_tasks"], many=True).data,
    })


@api_view(["GET"])
@cached_read("person-day", (SCOPES.TODOS, SCOPES.PLAN, SCOPES.PEOPLE), "CACHE_TTL_DAY")
def person_day(request, user_id: int):
    """Somebody else's day. Owners only, and only for their own people."""
    subject = get_object_or_404(User, pk=user_id)
    if not _may_see(request.user, subject):
        return Response({"detail": "Not your team member."}, status=status.HTTP_403_FORBIDDEN)

    day = _parse_date(request)
    data = day_view(subject, day)
    return Response({
        "user": UserSerializer(subject).data,
        "date": day,
        "counts": data["counts"],
        "todos": TodoSerializer(data["todos"], many=True).data,
        "suggestions": TaskSerializer(data["suggestions"], many=True).data,
        "open_tasks": TaskSerializer(data["open_tasks"], many=True).data,
    })


@api_view(["GET"])
@cached_read("todo-history", (SCOPES.TODOS, SCOPES.PEOPLE), "CACHE_TTL_LIST")
def todo_history(request, user_id: int):
    """What somebody's list said, day by day.

    ``?days=`` bounds the window. Days with nothing on them are omitted rather
    than rendered as empty rows — a fortnight of blanks is not history.
    """
    subject = get_object_or_404(User, pk=user_id)
    if not _may_see(request.user, subject):
        return Response({"detail": "Not your team member."}, status=status.HTTP_403_FORBIDDEN)

    try:
        days = max(1, min(int(request.query_params.get("days", 30)), 180))
    except (TypeError, ValueError):
        days = 30

    start = timezone.localdate() - timezone.timedelta(days=days)
    rows = (
        Todo.objects.filter(user=subject, date__gte=start)
        .select_related("task__milestone__project")
        .order_by("-date", "-carry_count", "id")
    )

    by_day: dict = {}
    for todo in rows:
        entry = by_day.setdefault(todo.date, {"date": todo.date, "todos": []})
        entry["todos"].append(todo)

    return Response({
        "user": UserSerializer(subject).data,
        "days": days,
        "history": [
            {
                "date": key,
                "total": len(value["todos"]),
                "done": sum(1 for t in value["todos"] if t.is_done),
                "todos": TodoSerializer(value["todos"], many=True).data,
            }
            for key, value in sorted(by_day.items(), reverse=True)
        ],
    })


@api_view(["POST"])
def create_todo(request):
    """Add a line to somebody's day.

    An owner may add to any of their people; everybody may add to their own.
    A todo need not correspond to anything in GitLab — that is the point of it.
    """
    serializer = TodoWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    subject = request.user
    if data.get("user_id") and data["user_id"] != request.user.id:
        subject = get_object_or_404(User, pk=data["user_id"])
        if not _may_see(request.user, subject) or not request.user.is_owner:
            return Response(
                {"detail": "You can only add todos for yourself."},
                status=status.HTTP_403_FORBIDDEN,
            )

    day = data.get("date") or timezone.localdate()
    ensure_day(subject, day)

    task = None
    source = TodoSource.MEETING if request.user.is_owner and subject != request.user else TodoSource.MANUAL
    if data.get("task_id"):
        task = Task.objects.filter(pk=data["task_id"]).first()
        if task is not None:
            source = TodoSource.TASK

    todo = Todo.objects.create(
        user=subject,
        date=day,
        title=data["title"],
        notes=data.get("notes", ""),
        task=task,
        source=source,
        first_added_on=day,
        created_by=request.user,
    )
    return Response(TodoSerializer(todo).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
def todo_detail(request, todo_id: int):
    """Tick a todo off, edit it, or remove it.

    Ticking means one thing now, whoever does it: finished. There was a
    two-stage version — a member's tick only "claimed" the line and an owner
    closed it in the round — and it was removed. It made ticking your own work
    feel like filing a request, and reopening something left the claim behind so
    the line came back as "marked done, waiting to be closed" rather than open.

    ``claimed`` is still accepted on the way in and treated as ``done``, so an
    older tab that has not reloaded does not start silently failing.
    """
    todo = get_object_or_404(
        Todo.objects.select_related("user", "task", "closed_by"), pk=todo_id
    )
    if not _may_see(request.user, todo.user):
        return Response({"detail": "Not your todo."}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "DELETE":
        todo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # A plain dict: request.data is a QueryDict for form posts, and immutable.
    changes = dict(request.data)
    if "claimed" in changes and "done" not in changes:
        changes["done"] = changes.pop("claimed")

    if "done" in changes:
        if changes["done"]:
            todo.done_at = todo.done_at or timezone.now()
            todo.closed_by = todo.closed_by or request.user
        else:
            # Reopening clears everything the closing set. Leaving any of it
            # behind is what produced the phantom "waiting to be closed".
            todo.done_at = None
            todo.closed_by = None

    if "title" in changes:
        todo.title = changes["title"]
    if "notes" in changes:
        todo.notes = changes["notes"]
    todo.save()
    return Response(TodoSerializer(todo).data)


# ---------------------------------------------------------------------------
# Alerts — the owner's own day, surfaced where they will see it
# ---------------------------------------------------------------------------


@api_view(["GET"])
@cached_read("my-alerts", (SCOPES.TODOS, SCOPES.PLAN), "CACHE_TTL_DAY")
def my_alerts(request):
    """What the signed-in person needs to deal with themselves.

    An owner carries todos like anybody else, and the risk is that running the
    team hides their own work from them. This is what the dashboard shows them
    about themselves.
    """
    day = timezone.localdate()
    todos = ensure_day(request.user, day)
    pending = [t for t in todos if t.status == "open"]
    stale = [t for t in pending if t.is_stale]

    overdue_tasks = list(
        Task.objects.filter(assignee=request.user, state=Task.State.OPEN, due_date__lt=day)
        .select_related("milestone__project")
        .order_by("due_date")[:10]
    )

    return Response({
        "date": day,
        "pending_count": len(pending),
        "done_count": sum(1 for t in todos if t.is_done),
        "stale": TodoSerializer(stale, many=True).data,
        "pending": TodoSerializer(pending, many=True).data,
        "overdue_tasks": TaskSerializer(overdue_tasks, many=True).data,
    })


# ---------------------------------------------------------------------------
# The morning meeting
# ---------------------------------------------------------------------------


@api_view(["GET"])
@cached_read("meeting", (SCOPES.TODOS, SCOPES.TEAMS, SCOPES.PLAN, SCOPES.PEOPLE), "CACHE_TTL_DAY")
def meeting_today(request, team_id: int):
    """The board the meeting screen opens on."""
    if not request.user.is_owner:
        return Response({"detail": "Owners only."}, status=status.HTTP_403_FORBIDDEN)

    team = get_object_or_404(Team, pk=team_id, owner=request.user)
    day = _parse_date(request)
    board = meeting_board(team, day, request.user)

    return Response({
        "meeting": MeetingSerializer(board["meeting"]).data,
        "rows": [
            {
                "user": UserSerializer(row["user"]).data,
                "is_owner": row["is_owner"],
                "note": (
                    {
                        "id": row["note"].id,
                        "attended": row["note"].attended,
                        "blockers": row["note"].blockers,
                        "notes": row["note"].notes,
                        "is_reviewed": row["note"].is_reviewed,
                    }
                    if row["note"] else None
                ),
                "pending": TodoSerializer(row["pending"], many=True).data,
                "done": TodoSerializer(row["done"], many=True).data,
                "suggestions": TaskSerializer(row["suggestions"], many=True).data,
                "overdue_tasks": TaskSerializer(row["overdue_tasks"], many=True).data,
                "stale_count": row["stale_count"],
                "last_meeting": (
                    {
                        **row["last_meeting"],
                        "todos": TodoSerializer(
                            row["last_meeting"]["todos"], many=True
                        ).data,
                    }
                    if row["last_meeting"] else None
                ),
            }
            for row in board["rows"]
        ],
    })


@api_view(["POST"])
def meeting_action(request, meeting_id: int):
    """Drive the round: start, move on, record a turn, finish.

    One endpoint rather than four, because every one of these is "the meeting
    moved" and the screen re-reads the same shape afterwards.
    """
    meeting = get_object_or_404(
        Meeting.objects.select_related("team"), pk=meeting_id, owner=request.user
    )
    action = str(request.data.get("action") or "").lower()

    if action == "start":
        start_meeting(meeting)
    elif action == "advance":
        advance_meeting(meeting, index=request.data.get("index"))
    elif action == "complete":
        complete_meeting(meeting, summary=request.data.get("summary", ""))
    elif action == "record":
        user_id = request.data.get("user_id")
        note = MeetingNote.objects.filter(meeting=meeting, user_id=user_id).first()
        if note is None:
            return Response({"detail": "Nobody by that id in this meeting."},
                            status=status.HTTP_400_BAD_REQUEST)
        if "attended" in request.data:
            note.attended = bool(request.data["attended"])
        if "blockers" in request.data:
            note.blockers = request.data["blockers"]
        if "notes" in request.data:
            note.notes = request.data["notes"]
        note.reviewed_at = timezone.now()
        note.save()
    else:
        return Response(
            {"detail": "Unknown action. Use start, advance, record or complete."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    meeting.refresh_from_db()
    return Response(MeetingSerializer(meeting).data)


@api_view(["GET"])
def meeting_history(request, team_id: int):
    """Past meetings for a team, most recent first."""
    if not request.user.is_owner:
        return Response({"detail": "Owners only."}, status=status.HTTP_403_FORBIDDEN)

    team = get_object_or_404(Team, pk=team_id, owner=request.user)
    meetings = (
        Meeting.objects.filter(team=team)
        .select_related("owner", "team")
        .prefetch_related("notes__user")
        .annotate(attended_count=Count("notes", filter=Q(notes__attended=True)))
        .order_by("-date")[:60]
    )
    return Response(MeetingSerializer(meetings, many=True).data)
