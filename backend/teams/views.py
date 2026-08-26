"""Teams: an owner's standing roster."""

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from accounts.permissions import IsOwner
from accounts.serializers import UserSerializer

from .models import Team, TeamMembership
from .serializers import (
    AddMemberSerializer,
    TeamSerializer,
    TeamWriteSerializer,
)

User = get_user_model()


class TeamViewSet(viewsets.ModelViewSet):
    """Owners manage their own teams; members can read the ones they are on."""

    serializer_class = TeamSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return super().get_permissions()
        return [IsOwner()]

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return TeamWriteSerializer
        return TeamSerializer

    def get_queryset(self):
        user = self.request.user
        base = Team.objects.select_related("owner").prefetch_related("memberships__user")
        if user.is_owner:
            return base.filter(owner=user)
        # A member sees the teams they are actually on, and nothing else.
        return base.filter(memberships__user=user, memberships__left_on__isnull=True).distinct()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        team = serializer.save(owner=request.user)
        return Response(TeamSerializer(team).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="members")
    def add_member(self, request, pk=None):
        """Put somebody on the roster.

        They must already have signed up — we cannot invent a GitLab identity,
        and without one they could never be assigned a task.
        """
        team = self.get_object()
        serializer = AddMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.get(pk=serializer.validated_data["user_id"])
        membership, created = TeamMembership.objects.get_or_create(
            team=team, user=user, left_on=None
        )
        return Response(
            TeamSerializer(team).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=["delete"], url_path=r"members/(?P<user_id>\d+)")
    def remove_member(self, request, pk=None, user_id=None):
        """Take somebody off the roster.

        Dated rather than deleted, so a past meeting still knows who was there.
        """
        from django.utils import timezone

        team = self.get_object()
        TeamMembership.objects.filter(team=team, user_id=user_id, left_on__isnull=True).update(
            left_on=timezone.localdate()
        )
        return Response(TeamSerializer(team).data)


@api_view(["GET"])
def directory(request):
    """Everyone signed up, for the owner to pick from when building a team.

    ``?q=`` filters by name or GitLab handle; ``?available_for=<team id>`` hides
    the people already on that team, because offering them again is noise.
    """
    people = User.objects.filter(is_active=True).exclude(role="")
    query = (request.query_params.get("q") or "").strip()
    if query:
        people = people.filter(
            Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(username__icontains=query)
            | Q(gitlab_username__icontains=query)
            | Q(email__icontains=query)
        )

    team_id = request.query_params.get("available_for")
    if team_id:
        already = TeamMembership.objects.filter(
            team_id=team_id, left_on__isnull=True
        ).values_list("user_id", flat=True)
        people = people.exclude(pk__in=already)

    return Response(UserSerializer(people.order_by("first_name", "username")[:100], many=True).data)
