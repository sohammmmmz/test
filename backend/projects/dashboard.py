"""The overview screen: every project's progress, and who is carrying what.

Two questions on one screen, because they are asked together. "Is anything
slipping" and "is anyone drowning" have the same answer surprisingly often, and
putting them side by side is what makes that visible.
"""

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from accounts.serializers import UserSerializer
from core.cache import SCOPES
from core.http import cached_read
from daily.services import ensure_days
from planning.models import Milestone, Task
from teams.models import TeamMembership

from .models import Project
from .serializers import ProjectListSerializer

User = get_user_model()


def _visible_projects(user):
    if user.is_owner:
        return Project.objects.filter(Q(owner=user) | Q(members__user=user)).distinct()
    return Project.objects.filter(members__user=user).distinct()


def _people_for(user):
    """Everyone this person is responsible for, plus themselves.

    The owner is in the list because they carry todos too and running the team
    is the easiest way to lose sight of your own work.
    """
    if not user.is_owner:
        return [user]
    member_ids = set(
        TeamMembership.objects.filter(team__owner=user, left_on__isnull=True)
        .values_list("user_id", flat=True)
    )
    member_ids.add(user.id)
    return list(User.objects.filter(pk__in=member_ids).order_by("first_name", "username"))


@api_view(["GET"])
@cached_read(
    "dashboard",
    # Genuinely everything: this screen is the join of projects, their plans,
    # today's lists and who is on which team. A narrower set of scopes here
    # would only mean showing one of those stale.
    (SCOPES.PROJECTS, SCOPES.PLAN, SCOPES.TODOS, SCOPES.TEAMS, SCOPES.PEOPLE),
    "CACHE_TTL_DASHBOARD",
)
def dashboard(request):
    """The overview.

    Note the ordering with the cache around it: ``ensure_day`` below *writes*
    the day's todos the first time it is asked for, which bumps the todo scope
    mid-build. The key was computed before the build started, so that first
    response is stored somewhere already unreachable and the next request builds
    it again. That is correct rather than clever — one wasted build per person
    per day, and never a list that is missing lines someone was about to be
    shown.
    """
    day = timezone.localdate()
    projects = list(
        _visible_projects(request.user)
        .select_related("repo", "owner", "team")
        .prefetch_related("members__user", "documents")
    )

    slipping = []
    for project in projects:
        progress = project.progress()
        if progress["is_slipping"]:
            slipping.append({"id": project.id, "name": project.name,
                             "overdue": progress["overdue_milestones"]})

    not_ready = [
        {"id": p.id, "name": p.name,
         "missing": [c["label"] for c in p.readiness()["checks"] if not c["passed"]]}
        for p in projects
        if not p.readiness()["is_ready"]
    ]

    # Workload, read from what people are actually holding rather than from a
    # plan somebody typed once.
    people = _people_for(request.user)
    person_ids = [p.id for p in people]

    # Grouped, rather than one set of queries per person. Rendering this screen
    # for a team of twelve used to mean around sixty round trips to Postgres —
    # three counts and a todo lookup each — and it grew with the team, which is
    # exactly the wrong direction for the screen a lead opens every morning.
    task_counts = {
        row["assignee_id"]: row
        for row in Task.objects.filter(
            assignee_id__in=person_ids, state=Task.State.OPEN
        )
        .values("assignee_id")
        .annotate(
            open_tasks=Count("id"),
            overdue_tasks=Count("id", filter=Q(due_date__lt=day)),
        )
    }
    project_counts = {
        row["members__user_id"]: row["n"]
        for row in Project.objects.filter(members__user_id__in=person_ids)
        .values("members__user_id")
        .annotate(n=Count("id", distinct=True))
    }

    days = ensure_days(people, day)

    workload = []
    for person in people:
        todos = days[person.id]
        pending = [t for t in todos if t.status == "open"]
        counts = task_counts.get(person.id, {})
        workload.append({
            "user": UserSerializer(person).data,
            "is_you": person.id == request.user.id,
            "open_tasks": counts.get("open_tasks", 0),
            "overdue_tasks": counts.get("overdue_tasks", 0),
            "todos_total": len(todos),
            "todos_pending": len(pending),
            "todos_stale": sum(1 for t in pending if t.is_stale),
            "project_count": project_counts.get(person.id, 0),
        })
    # Busiest first: the person about to drop something should not be
    # somewhere down an alphabetical list.
    workload.sort(key=lambda r: (-r["overdue_tasks"], -r["todos_stale"], -r["open_tasks"]))

    milestones = (
        Milestone.objects.filter(project__in=projects, state=Milestone.State.ACTIVE,
                                 due_date__isnull=False)
        .select_related("project")
        .annotate(
            task_total=Count("tasks"),
            task_done=Count("tasks", filter=Q(tasks__state=Task.State.CLOSED)),
        )
        .order_by("due_date")[:8]
    )

    return Response({
        "date": day,
        "totals": {
            "projects": len(projects),
            # In flight rather than one named status: the lifecycle has seven
            # phases between draft and closed, and every one of them is work
            # under way.
            "active_projects": sum(1 for p in projects if p.is_in_flight),
            "slipping": len(slipping),
            "not_ready": len(not_ready),
            "people": len(people),
            "open_tasks": Task.objects.filter(
                milestone__project__in=projects, state=Task.State.OPEN
            ).count(),
        },
        "projects": ProjectListSerializer(projects, many=True).data,
        "slipping": slipping,
        "not_ready": not_ready,
        "workload": workload,
        "upcoming_milestones": [
            {
                "id": m.id,
                "title": m.title,
                "project_id": m.project_id,
                "project": m.project.name,
                "due_date": m.due_date,
                "days_remaining": m.days_remaining,
                "is_overdue": m.is_overdue,
                "total": m.task_total,
                "done": m.task_done,
            }
            for m in milestones
        ],
    })
