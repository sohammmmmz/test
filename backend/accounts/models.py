"""Who is using the tool, and what they are allowed to do.

Everyone arrives through GitLab OAuth, because assigning a GitLab issue needs a
real ``gitlab_user_id`` — a person who exists only in this database cannot be
given work. What GitLab cannot tell us is which of the two roles they hold and
which department they sit in, so a first sign-in lands on an onboarding step
and stays there until both are answered.
"""

import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    OWNER = "owner", "Project owner"
    MEMBER = "member", "Project member"


class Department(models.TextChoices):
    ENGINEERING = "engineering", "Engineering"
    DESIGN = "design", "Design"
    QA = "qa", "Quality assurance"
    PRODUCT = "product", "Product"
    DATA = "data", "Data"
    OPERATIONS = "operations", "Operations"


class User(AbstractUser):
    """A person, identified by their GitLab account."""

    email = models.EmailField(unique=True)

    gitlab_user_id = models.BigIntegerField(unique=True, null=True, blank=True, db_index=True)
    gitlab_username = models.CharField(max_length=255, blank=True, db_index=True)
    gitlab_avatar_url = models.URLField(blank=True)
    gitlab_web_url = models.URLField(blank=True)

    role = models.CharField(max_length=16, choices=Role.choices, blank=True)
    department = models.CharField(max_length=32, choices=Department.choices, blank=True)
    job_title = models.CharField(max_length=255, blank=True)

    # Both role and department are needed before the app can be used, so this
    # is the one flag the frontend gates every route on.
    onboarded_at = models.DateTimeField(null=True, blank=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["first_name", "username"]

    def __str__(self):
        return self.display_name

    @property
    def display_name(self) -> str:
        full = (self.get_full_name() or "").strip()
        return full or self.gitlab_username or self.username

    @property
    def is_owner(self) -> bool:
        return self.role == Role.OWNER

    @property
    def is_onboarded(self) -> bool:
        return bool(self.role and self.department)

    def complete_onboarding(self, *, role: str, department: str, job_title: str = "") -> None:
        self.role = role
        self.department = department
        self.job_title = job_title
        self.onboarded_at = timezone.now()
        self.save(update_fields=["role", "department", "job_title", "onboarded_at"])


class GitLabToken(models.Model):
    """A user's GitLab OAuth tokens.

    Used only to act *as that person* against GitLab — chiefly proving they can
    see a repository. Every write this app performs uses the service token
    instead, so nothing shared breaks when one of these expires.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="gitlab_token")
    access_token = models.TextField()
    refresh_token = models.TextField(blank=True)
    scope = models.CharField(max_length=255, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_revoked = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"GitLab token for {self.user}"

    def is_expired(self, leeway_seconds: int = 120) -> bool:
        if self.expires_at is None:
            return False
        return timezone.now() >= self.expires_at - timezone.timedelta(seconds=leeway_seconds)


class OAuthState(models.Model):
    """Single-use CSRF state for the authorization-code round trip."""

    state = models.CharField(max_length=128, unique=True, db_index=True)
    redirect_to = models.CharField(max_length=512, blank=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.state

    @property
    def is_usable(self) -> bool:
        return self.consumed_at is None and timezone.now() < self.expires_at


class RefreshSession(models.Model):
    """One sign-in on one device, alive across many refresh rotations.

    Only a hash of the currently valid refresh token id is stored, so nothing
    here is replayable. Presenting a superseded token means it was captured, and
    the whole session is revoked rather than the single request refused.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="refresh_sessions")
    token_hash = models.CharField(max_length=64, db_index=True)
    previous_token_hash = models.CharField(max_length=64, blank=True)
    rotated_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def revoke(self) -> None:
        if self.revoked_at is None:
            self.revoked_at = timezone.now()
            self.save(update_fields=["revoked_at"])
