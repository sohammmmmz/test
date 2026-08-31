"""What to tell someone about work that happened while they were not looking.

The screen confirms an action the moment it is taken, before the server has
answered. That is what makes the app feel immediate, and it is also a promise:
if the write turns out to have failed, the person has already been told it
succeeded and moved on. This model is how that promise is kept — the failure
comes back to them, named, with the request still on file so it can be tried
again.

Rows are written from two directions. The browser records what it saw fail,
because a 500 is delivered to the caller and nowhere else. The server writes
its own for work that finishes after the request that started it — a reconcile,
a repository delete. Both end up in the same list.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone


class NotificationKind(models.TextChoices):
    FAILED = "failed", "Action failed"
    DONE = "done", "Action finished"
    INFO = "info", "Information"


class Notification(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    kind = models.CharField(
        max_length=16, choices=NotificationKind.choices, default=NotificationKind.FAILED
    )
    title = models.CharField(max_length=512)
    body = models.TextField(blank=True, default="")

    # Where the person should be sent to see the thing this is about.
    target_url = models.CharField(max_length=512, blank=True, default="")

    # The request to run again, stored as its parts rather than a URL string so
    # nothing here can be turned into a fetch at some other origin. Replayed by
    # the browser with the person's own cookies, so it can do nothing they could
    # not already do by clicking the button a second time.
    retry_method = models.CharField(max_length=8, blank=True, default="")
    retry_path = models.CharField(max_length=512, blank=True, default="")
    retry_body = models.JSONField(null=True, blank=True)

    # One failing button pressed six times is one problem, not six. The browser
    # sends a stable key per action and the newest attempt updates the row.
    dedupe_key = models.CharField(max_length=128, blank=True, default="")
    attempts = models.PositiveIntegerField(default=1)

    read_at = models.DateTimeField(null=True, blank=True)
    # Set when a retry finally worked. Kept rather than deleted so the list can
    # say "this one sorted itself out" instead of silently losing a line the
    # person was watching.
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["user", "read_at"]),
            models.Index(fields=["user", "dedupe_key"]),
        ]

    def __str__(self):
        return f"{self.get_kind_display()}: {self.title}"

    @property
    def is_read(self) -> bool:
        return self.read_at is not None

    @property
    def is_resolved(self) -> bool:
        return self.resolved_at is not None

    @property
    def can_retry(self) -> bool:
        return bool(self.retry_path) and not self.is_resolved

    def mark_read(self):
        if self.read_at is None:
            self.read_at = timezone.now()
            self.save(update_fields=["read_at", "updated_at"])

    def resolve(self):
        now = timezone.now()
        self.resolved_at = now
        self.kind = NotificationKind.DONE
        if self.read_at is None:
            self.read_at = now
        self.save(update_fields=["resolved_at", "kind", "read_at", "updated_at"])
