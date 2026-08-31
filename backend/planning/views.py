"""Milestones and tasks. Every write goes to GitLab first."""

from django.contrib.auth import get_user_model
from django.db.models import Count, Prefetch, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from accounts.permissions import IsOwner
from core.cache import SCOPES
from core.http import CachedListMixin
from projects.models import Project

from .models import Issue, Milestone, Task
from .serializers import (
    IssueSerializer,
    IssueUpdateSerializer,
    IssueWriteSerializer,
    MilestoneSerializer,
    MilestoneUpdateSerializer,
    MilestoneWriteSerializer,
    TaskSerializer,
    TaskUpdateSerializer,
    TaskWriteSerializer,
)
from .services import (
    PlanningError,
    create_milestone,
    create_task,
    log_issue,
    update_issue,
    InheritedMilestone,
    delete_milestone,
    reconcile_project,
    update_milestone,
    update_task,
)

User = get_user_model()


def _tasks_with_issue_counts():
    """Tasks, each carrying how many issues are open against it."""
    return (
        Task.objects.select_related("assignee", "milestone__project")
        .annotate(
            open_issues=Count("issues", filter=Q(issues__state=Issue.State.OPEN))
        )
    )


def _visible_projects(user):
    """Projects this person may see at all."""
    if user.is_owner:
        return Project.objects.filter(Q(owner=user) | Q(members__user=user)).distinct()
    return Project.objects.filter(members__user=user).distinct()


class MilestoneViewSet(CachedListMixin, viewsets.ModelViewSet):
    serializer_class = MilestoneSerializer
    # Every milestone is serialized with its tasks nested, so this is the
    # single most expensive read in the app and the one worth caching most.
    cache_scopes = (SCOPES.PLAN, SCOPES.PROJECTS, SCOPES.PEOPLE)
    cache_ttl_setting = "CACHE_TTL_PLAN"

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return super().get_permissions()
        return [IsOwner()]

    def get_queryset(self):
        qs = (
            Milestone.objects.filter(project__in=_visible_projects(self.request.user))
            .select_related("project")
            # The tasks are prefetched through an annotated queryset rather than
            # plain, so each task's open-issue count comes back with it. Without
            # this the serializer counts per task, which on a milestone of forty
            # is forty queries to render one card.
            .prefetch_related(
                Prefetch("tasks", queryset=_tasks_with_issue_counts()),
            )
        )
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        state = self.request.query_params.get("state")
        if state:
            qs = qs.filter(state=state)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = MilestoneWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        project = _visible_projects(request.user).filter(pk=data["project"]).first()
        if project is None:
            return Response({"detail": "No such project."}, status=status.HTTP_404_NOT_FOUND)

        try:
            milestone = create_milestone(
                project,
                title=data["title"],
                description=data.get("description", ""),
                start_date=data.get("start_date"),
                due_date=data["due_date"],
            )
        except PlanningError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(MilestoneSerializer(milestone).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        return self._patch(request, partial=kwargs.get("partial", False))

    def partial_update(self, request, *args, **kwargs):
        return self._patch(request, partial=True)

    def _patch(self, request, *, partial: bool):
        milestone = self.get_object()
        serializer = MilestoneUpdateSerializer(data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        try:
            milestone = update_milestone(milestone, **serializer.validated_data)
        except (PlanningError, InheritedMilestone) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MilestoneSerializer(milestone).data)

    def destroy(self, request, *args, **kwargs):
        try:
            delete_milestone(self.get_object())
        except InheritedMilestone as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TaskViewSet(CachedListMixin, viewsets.ModelViewSet):
    """Read for everyone on the project; write for owners and the assignee.

    An assignee closing their own task is the single most common action in the
    product, so it would be perverse to make them ask an owner.
    """

    serializer_class = TaskSerializer
    cache_scopes = (SCOPES.PLAN, SCOPES.PEOPLE)
    cache_ttl_setting = "CACHE_TTL_PLAN"

    def get_queryset(self):
        qs = _tasks_with_issue_counts().filter(
            milestone__project__in=_visible_projects(self.request.user)
        )
        for param, field in (
            ("project", "milestone__project_id"),
            ("milestone", "milestone_id"),
            ("assignee", "assignee_id"),
            ("state", "state"),
        ):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{field: value})
        if self.request.query_params.get("mine") == "true":
            qs = qs.filter(assignee=self.request.user)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = TaskWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        milestone = (
            Milestone.objects.filter(
                pk=data["milestone"], project__in=_visible_projects(request.user)
            )
            .select_related("project")
            .first()
        )
        if milestone is None:
            return Response({"detail": "No such milestone."}, status=status.HTTP_404_NOT_FOUND)
        if not request.user.is_owner:
            return Response(
                {"detail": "Only project owners can create tasks."},
                status=status.HTTP_403_FORBIDDEN,
            )

        assignee = None
        if data.get("assignee_id"):
            assignee = User.objects.filter(pk=data["assignee_id"]).first()

        try:
            task = create_task(
                milestone,
                title=data["title"],
                description=data.get("description", ""),
                assignee=assignee,
                due_date=data.get("due_date"),
                labels=data.get("labels"),
            )
        except PlanningError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(TaskSerializer(task).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        return self._patch(request)

    def partial_update(self, request, *args, **kwargs):
        return self._patch(request)

    def _patch(self, request):
        task = self.get_object()
        is_assignee = task.assignee_id == request.user.id
        if not (request.user.is_owner or is_assignee):
            return Response(
                {"detail": "You can only change tasks assigned to you."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TaskUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fields = dict(serializer.validated_data)

        if "assignee_id" in fields:
            if not request.user.is_owner:
                return Response(
                    {"detail": "Only project owners can reassign a task."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            assignee_id = fields.pop("assignee_id")
            fields["assignee"] = User.objects.filter(pk=assignee_id).first() if assignee_id else None

        try:
            task = update_task(task, **fields)
        except PlanningError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TaskSerializer(task).data)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_owner:
            return Response(
                {"detail": "Only project owners can delete tasks."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)


class IssueViewSet(CachedListMixin, viewsets.ModelViewSet):
    """Problems raised against a task.

    Anyone who can see the project can log one and can see the rest. That is
    deliberate and different from milestones and tasks, which only an owner
    writes: the person who finds a defect is almost never the person who planned
    the work, and a tool that makes them ask someone else to file it is a tool
    where defects do not get filed.

    Resolving is narrower — the owner, the person it is assigned to, or whoever
    raised it. Anybody being able to close anybody's bug report is how a list
    stops meaning anything.
    """

    serializer_class = IssueSerializer
    cache_scopes = (SCOPES.PLAN, SCOPES.PROJECTS, SCOPES.PEOPLE)
    cache_ttl_setting = "CACHE_TTL_PLAN"

    def get_queryset(self):
        qs = (
            Issue.objects.filter(
                task__milestone__project__in=_visible_projects(self.request.user)
            )
            .select_related("task__milestone__project", "assignee", "reported_by")
        )
        for param, field in (
            ("task", "task_id"),
            ("project", "task__milestone__project_id"),
            ("milestone", "task__milestone_id"),
            ("assignee", "assignee_id"),
            ("state", "state"),
            ("severity", "severity"),
        ):
            value = self.request.query_params.get(param)
            if value:
                qs = qs.filter(**{field: value})
        return qs

    def _task_or_none(self, task_id):
        return (
            Task.objects.filter(
                pk=task_id, milestone__project__in=_visible_projects(self.request.user)
            )
            .select_related("milestone__project__repo")
            .first()
        )

    def create(self, request, *args, **kwargs):
        form = IssueWriteSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data

        task = self._task_or_none(data["task"])
        if task is None:
            return Response({"detail": "No such task."}, status=status.HTTP_404_NOT_FOUND)

        assignee = None
        if data.get("assignee_id"):
            assignee = User.objects.filter(pk=data["assignee_id"]).first()

        try:
            issue = log_issue(
                task,
                title=data["title"],
                description=data.get("description", ""),
                severity=data.get("severity") or Issue.Severity.MEDIUM,
                reported_by=request.user,
                assignee=assignee,
            )
        except PlanningError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(IssueSerializer(issue).data, status=status.HTTP_201_CREATED)

    def _may_change(self, issue) -> bool:
        user = self.request.user
        return (
            user.is_owner
            or issue.reported_by_id == user.id
            or issue.assignee_id == user.id
        )

    def partial_update(self, request, *args, **kwargs):
        issue = self.get_object()
        if not self._may_change(issue):
            return Response(
                {"detail": "Only the owner, the assignee, or whoever raised it "
                           "can change this issue."},
                status=status.HTTP_403_FORBIDDEN,
            )

        form = IssueUpdateSerializer(data=request.data, partial=True)
        form.is_valid(raise_exception=True)
        fields = dict(form.validated_data)
        if "assignee_id" in fields:
            assignee_id = fields.pop("assignee_id")
            fields["assignee"] = (
                User.objects.filter(pk=assignee_id).first() if assignee_id else None
            )

        try:
            issue = update_issue(issue, **fields)
        except PlanningError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(IssueSerializer(issue).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # Deleting here would leave the GitLab issue orphaned and still open,
        # which is worse than the row staying. Resolve it instead.
        return Response(
            {"detail": "Issues are resolved, not deleted. Set state to closed."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )


@api_view(["POST"])
def reconcile(request, project_id: int):
    """Pull milestones and work items back from GitLab.

    Two callers, and they want different things. Opening a project fires this in
    the background and does not wait for it, so it is throttled — the screen is
    already rendered from what is stored, and a refresh a moment later picks up
    anything new. The Sync button sends ``force`` and always goes to GitLab,
    because a person who presses Sync and is told "synced" without a request
    leaving the building has been lied to.
    """
    project = _visible_projects(request.user).filter(pk=project_id).first()
    if project is None:
        return Response({"detail": "No such project."}, status=status.HTTP_404_NOT_FOUND)
    force = str(request.data.get("force", "")).lower() in ("1", "true", "yes")
    return Response(reconcile_project(project, force=force))
