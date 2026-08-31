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

    # What GitLab made it: "task" for anything created here, "issue" for work
    # that was planned in GitLab or predates the two being told apart. Kept so
    # the screen can say which, rather than quietly calling an issue a task.
    work_item_type = models.CharField(max_length=32, default="task", blank=True)

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


class Issue(models.Model):
    """Something wrong, raised against a task.

    A task is work somebody planned; an issue is a problem found while doing it.
    Keeping them apart matters because the plan should not silently grow every
    time a bug is found — the milestone's progress is about the work, and a
    defect logged against it is a different question.

    **Where it lives depends on the task.** If the task exists in GitLab, the
    issue is filed there too, as a real GitLab issue (``issue_type=issue``, not
    ``task``), so the people working in GitLab see it without being told. If the
    task is local — no repository, or a GitLab write that never landed — the
    issue is held here alone. Either way it is the same row and the same screen;
    ``is_in_gitlab`` is the only difference anybody sees.
    """

    class State(models.TextChoices):
        OPEN = "opened", "Open"
        CLOSED = "closed", "Resolved"

    class Severity(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="issues")

    title = models.CharField(max_length=512)
    description = models.TextField(blank=True)
    severity = models.CharField(
        max_length=16, choices=Severity.choices, default=Severity.MEDIUM
    )
    state = models.CharField(max_length=16, choices=State.choices, default=State.OPEN)

    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="reported_issues",
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="assigned_issues",
    )

    # Blank on an issue this app holds alone.
    gitlab_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    gitlab_iid = models.PositiveIntegerField(null=True, blank=True, db_index=True)
    web_url = models.URLField(blank=True)

    # Whether GitLab's own "related issues" link was accepted. False is not a
    # failure worth showing: the issue description carries a #reference to the
    # task either way, which is what makes them findable from each other on
    # every tier and every version.
    is_linked = models.BooleanField(default=False)

    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["state", "-created_at"]
        indexes = [
            models.Index(fields=["task", "state"]),
            models.Index(fields=["assignee", "state"]),
        ]

    def __str__(self):
        return self.title

    @property
    def is_in_gitlab(self) -> bool:
        return self.gitlab_iid is not None

    @property
    def is_open(self) -> bool:
        return self.state == self.State.OPEN

    @property
    def project_id(self) -> int:
        return self.task.milestone.project_id
