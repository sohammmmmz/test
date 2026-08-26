"""An owner's team, assembled from people who have already signed up.

A team is not a project. Owners keep a standing roster and draw project members
from it, because the same five people usually staff three repositories and
re-picking them each time is how a roster drifts out of date.

A person can sit on more than one owner's team — realistic in a matrixed org,
and the reason the morning meeting is scoped to a team rather than to an owner.
"""

import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


class Team(models.Model):
    """A roster owned by one project owner."""

    name = models.CharField(max_length=255)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_teams"
    )
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "name"], name="uniq_team_name_per_owner")
        ]

    def __str__(self):
        return self.name

    @property
    def member_count(self) -> int:
        return self.memberships.count()


class TeamMembership(models.Model):
    """One person's place on one team.

    Kept as its own row rather than a many-to-many so joining and leaving are
    dated — the morning meeting needs to know who was on the team on a given
    day, not only who is on it now.
    """

    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_memberships"
    )
    joined_on = models.DateField(auto_now_add=True)
    left_on = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["user__first_name", "user__username"]
        constraints = [
            models.UniqueConstraint(
                fields=["team", "user"],
                condition=models.Q(left_on__isnull=True),
                name="uniq_active_membership",
            )
        ]

    def __str__(self):
        return f"{self.user} on {self.team}"

    @property
    def is_active(self) -> bool:
        return self.left_on is None


class TeamInvite(models.Model):
    """A shareable link that joins whoever follows it to one team.

    The alternative — an owner adding people by hand — needs the person to
    already exist here, which they cannot until they have signed in, which they
    will not do without being asked. A link breaks that circle: it carries the
    team through the GitLab handshake, so signing in and joining are one act.

    The token is the credential, so it is generated with `secrets` and is the
    only thing that identifies the invite.
    """

    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="invites")
    token = models.CharField(max_length=64, unique=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_invites"
    )
    note = models.CharField(max_length=255, blank=True)

    expires_at = models.DateTimeField(null=True, blank=True)
    # Null means no limit. A link pasted into a team channel wants no limit; a
    # link sent to one person wants exactly one use.
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    uses = models.PositiveIntegerField(default=0)
    revoked_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"invite to {self.team.name}"

    @staticmethod
    def new_token() -> str:
        return secrets.token_urlsafe(24)

    @property
    def is_usable(self) -> bool:
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None and self.expires_at <= timezone.now():
            return False
        if self.max_uses is not None and self.uses >= self.max_uses:
            return False
        return True

    @property
    def state(self) -> str:
        """Why a link is not usable, in a word the UI can show."""
        if self.revoked_at is not None:
            return "revoked"
        if self.expires_at is not None and self.expires_at <= timezone.now():
            return "expired"
        if self.max_uses is not None and self.uses >= self.max_uses:
            return "used up"
        return "active"

    def redeem(self, user) -> bool:
        """Put ``user`` on the team. True when this actually added them."""
        membership, created = TeamMembership.objects.get_or_create(
            team=self.team, user=user, left_on=None
        )
        # Counted per redemption rather than per person, so a single-use link
        # cannot be handed round.
        self.uses += 1
        self.save(update_fields=["uses"])
        return created
