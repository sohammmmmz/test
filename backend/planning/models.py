"""Milestones and tasks — mirrors of real GitLab objects.

Two levels, deliberately. A milestone holds tasks directly and each task is one
GitLab issue with one assignee. GitLab's child work items do not inherit their
parent's milestone, so a third level would mean maintaining in Postgres a
relationship GitLab would not maintain for us.

Everything here is written upstream the moment it is created or edited, and
re-read when a project is opened. GitLab stays the source of truth; this table
exists so a screen can be drawn without a round trip per row.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone


class Milestone(models.Model):
    class State(models.TextChoices):
        ACTIVE = "active", "Active"
        CLOSED = "closed", "Closed"

    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, related_name="milestones"
    )
    gitlab_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    gitlab_iid = models.PositiveIntegerField(null=True, blank=True)

    title = models.CharField(max_length=512)
    description = models.TextField(blank=True)
    state = models.CharField(max_length=16, choices=State.choices, default=State.ACTIVE)
    start_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    web_url = models.URLField(blank=True)

    # Inherited from a parent group rather than belonging to this project.
    # Work can be filed under it, but it cannot be edited or deleted through
    # the project's own endpoint — so the screen must not offer to.
    is_inherited = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "title"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "gitlab_id"],
                condition=models.Q(gitlab_id__isnull=False),
                name="uniq_milestone_per_project",
            )
        ]

    def __str__(self):
        return self.title

    @property
    def is_overdue(self) -> bool:
        return bool(
            self.due_date
            and self.state == self.State.ACTIVE
            and self.due_date < timezone.localdate()
        )

    @property
    def days_remaining(self) -> int | None:
        if not self.due_date:
            return None
        return (self.due_date - timezone.localdate()).days

    def progress(self) -> dict:
        total = self.tasks.count()
        done = self.tasks.filter(state=Task.State.CLOSED).count()
        return {
            "total": total,
            "done": done,
            "percent": round(done / total * 100) if total else 0,
        }


class Task(models.Model):
    """One GitLab issue: a unit of work with a single owner.

    ``assignee`` is nullable and single, because multiple assignees is a
    Premium feature — and because a task everybody owns is a task nobody owns.
    """

    class State(models.TextChoices):
        OPEN = "opened", "Open"
        CLOSED = "closed", "Done"

    milestone = models.ForeignKey(
        Milestone, on_delete=models.CASCADE, related_name="tasks"
    )
    gitlab_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    gitlab_iid = models.PositiveIntegerField(null=True, blank=True, db_index=True)

    title = models.CharField(max_length=512)
    description = models.TextField(blank=True)
    state = models.CharField(max_length=16, choices=State.choices, default=State.OPEN)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="tasks",
    )
    due_date = models.DateField(null=True, blank=True)
    labels = models.JSONField(default=list, blank=True)
    web_url = models.URLField(blank=True)

    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["due_date", "-created_at"]
        indexes = [
            models.Index(fields=["assignee", "state"]),
            models.Index(fields=["milestone", "state"]),
        ]

    def __str__(self):
        return self.title

    @property
    def project(self):
        return self.milestone.project

    @property
    def is_overdue(self) -> bool:
        return bool(
            self.due_date
            and self.state == self.State.OPEN
            and self.due_date < timezone.localdate()
        )
