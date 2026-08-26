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
from daily.models import Todo
from daily.services import ensure_day
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
def dashboard(request):
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
    workload = []
    for person in people:
        todos = ensure_day(person, day)
        pending = [t for t in todos if not t.is_done]
        open_tasks = Task.objects.filter(assignee=person, state=Task.State.OPEN)
        workload.append({
            "user": UserSerializer(person).data,
            "is_you": person.id == request.user.id,
            "open_tasks": open_tasks.count(),
            "overdue_tasks": open_tasks.filter(due_date__lt=day).count(),
            "todos_total": len(todos),
            "todos_pending": len(pending),
            "todos_stale": sum(1 for t in pending if t.is_stale),
            "project_count": Project.objects.filter(members__user=person).distinct().count(),
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
            "active_projects": sum(1 for p in projects if p.status == "active"),
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
