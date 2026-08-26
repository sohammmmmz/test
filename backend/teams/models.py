"""An owner's team, assembled from people who have already signed up.

A team is not a project. Owners keep a standing roster and draw project members
from it, because the same five people usually staff three repositories and
re-picking them each time is how a roster drifts out of date.

A person can sit on more than one owner's team — realistic in a matrixed org,
and the reason the morning meeting is scoped to a team rather than to an owner.
"""

from django.conf import settings
from django.db import models


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
