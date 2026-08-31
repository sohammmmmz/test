"""Milestones and tasks. Every write goes to GitLab first."""

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from accounts.permissions import IsOwner
from core.cache import SCOPES
from core.http import CachedListMixin
from projects.models import Project

from .models import Milestone, Task
from .serializers import (
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
    InheritedMilestone,
    delete_milestone,
    reconcile_project,
    update_milestone,
    update_task,
)

User = get_user_model()


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
            .prefetch_related("tasks__assignee")
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
        qs = (
            Task.objects.filter(milestone__project__in=_visible_projects(self.request.user))
            .select_related("assignee", "milestone__project")
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
