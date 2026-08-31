"""Teams: an owner's standing roster."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from accounts.permissions import IsOwner
from accounts.serializers import UserSerializer

from core.cache import SCOPES
from core.http import CachedListMixin

from .models import Team, TeamInvite, TeamMembership, ensure_general_team
from .serializers import (
    AddMemberSerializer,
    CreateInviteSerializer,
    TeamInviteSerializer,
    TeamSerializer,
    TeamWriteSerializer,
)

User = get_user_model()


def _live_invites(team):
    """The links worth showing: anything not turned off.

    Expired and spent links stay in the list — they explain themselves, and an
    owner wondering why nobody arrived should be able to see that the link ran
    out. Revoked ones are deleted outright, so they never reach here.
    """
    return team.invites.filter(revoked_at__isnull=True).select_related("created_by")


class TeamViewSet(CachedListMixin, viewsets.ModelViewSet):
    """Owners manage their own teams; members can read the ones they are on."""

    serializer_class = TeamSerializer
    # A team's card shows its roster, and General's roster is the union of every
    # other team's — so no team is cacheable independently of the rest.
    cache_scopes = (SCOPES.TEAMS, SCOPES.PEOPLE)

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
            # Every owner has a General team. Made here rather than at sign-up
            # so owners who predate it get one too.
            ensure_general_team(user)
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

    def _reject_if_general(self, team):
        """General has no roster of its own, so nothing can be added to it.

        It is every person on every other team this owner keeps, worked out on
        read. Putting somebody on it directly would create a row that never
        shows up, which reads as the click having failed.
        """
        if not team.is_general:
            return None
        return Response(
            {"detail": f"{team.name} is everyone on your other teams. "
                       "Add people to one of those and they appear here."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def update(self, request, *args, **kwargs):
        refusal = self._reject_if_general(self.get_object())
        return refusal or super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        refusal = self._reject_if_general(self.get_object())
        return refusal or super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        team = self.get_object()
        if team.is_general:
            return Response(
                {"detail": f"{team.name} cannot be deleted. It is not a roster you keep."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="members")
    def add_member(self, request, pk=None):
        """Put somebody on the roster.

        They must already have signed up — we cannot invent a GitLab identity,
        and without one they could never be assigned a task.
        """
        team = self.get_object()
        refusal = self._reject_if_general(team)
        if refusal is not None:
            return refusal

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

    @action(detail=True, methods=["get", "post"], url_path="invites")
    def invites(self, request, pk=None):
        """List this team's invite links, or mint a new one.

        The link is what makes joining possible at all: somebody cannot be added
        by hand until they exist here, and they will not exist until they have
        signed in — which they will not do unless asked. The link carries the
        team through the GitLab handshake so both happen at once.
        """
        team = self.get_object()

        if request.method == "GET":
            return Response(TeamInviteSerializer(_live_invites(team), many=True).data)

        refusal = self._reject_if_general(team)
        if refusal is not None:
            return refusal

        serializer = CreateInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        expires_at = None
        if data.get("expires_in_days"):
            expires_at = timezone.now() + timedelta(days=data["expires_in_days"])

        invite = TeamInvite.objects.create(
            team=team,
            token=TeamInvite.new_token(),
            created_by=request.user,
            note=data.get("note", ""),
            max_uses=data.get("max_uses"),
            expires_at=expires_at,
        )
        return Response(TeamInviteSerializer(invite).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"invites/(?P<token>[-\w]+)")
    def revoke_invite(self, request, pk=None, token=None):
        """Turn a link off, and stop listing it.

        The row goes rather than being flagged. A dead link has nothing left to
        say: whoever joined through it is on the roster in their own right, and
        a struck-through entry that can never be used again is only clutter
        between the owner and the links that still work.
        """
        team = self.get_object()
        TeamInvite.objects.filter(team=team, token=token).delete()
        return Response(TeamInviteSerializer(_live_invites(team), many=True).data)

    @action(detail=True, methods=["delete"], url_path=r"members/(?P<user_id>\d+)")
    def remove_member(self, request, pk=None, user_id=None):
        """Take somebody off the roster.

        Dated rather than deleted, so a past meeting still knows who was there.
        """
        team = self.get_object()
        refusal = self._reject_if_general(team)
        if refusal is not None:
            return refusal

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
        team = Team.objects.filter(pk=team_id).first()
        already = [m.user_id for m in team.roster()] if team else []
        people = people.exclude(pk__in=already)

    return Response(UserSerializer(people.order_by("first_name", "username")[:100], many=True).data)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def invite_details(request, token: str):
    """What a join link points at, for the page that shows it.

    Deliberately open: somebody following an invite is by definition not signed
    in yet. It returns the team name and nothing else — enough to say what they
    are joining, and no roster to enumerate.
    """
    invite = TeamInvite.objects.filter(token=token).select_related("team", "team__owner").first()
    if invite is None:
        return Response({"valid": False, "reason": "unknown"}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        "valid": invite.is_usable,
        "reason": invite.state,
        "team": invite.team.name,
        "invited_by": invite.team.owner.display_name,
    })
