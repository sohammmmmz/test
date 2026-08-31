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
    """Something wrong, raised against a piece of work.

    A task is work somebody planned; an issue is a problem found while doing it.
    Keeping them apart matters because the plan should not silently grow every
    time a bug is found — the milestone's progress is about the work, and a
    defect logged against it is a different question.

    **It can hang off either a task or a todo, and needs only one of them.**
    Most defects are found while doing planned work, and those point at a task.
    But plenty of work is a line somebody wrote on their own day that was never
    part of any milestone, and refusing to record a problem with it — because
    the thing it concerns is not in the plan — is how a defect ends up in a
    message to somebody instead of in the system.

    ``raised_against`` is a snapshot of what it was logged against, written once
    at creation. A todo is deleted routinely, and an issue whose anchor has gone
    should still say what it was about rather than become an orphan nobody can
    interpret.

    **Where it is filed depends on the task.** A task that exists in GitLab gets
    a real GitLab issue (``issue_type=issue``, not ``task``), so the people
    working in GitLab see it without being told. Anything else — a local task, a
    bare todo — is held here alone. Same row, same screen; ``is_in_gitlab`` is
    the only difference anybody sees.
    """

    class State(models.TextChoices):
        OPEN = "opened", "Open"
        CLOSED = "closed", "Resolved"

    class Severity(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    # One of these two is always set. Both can be, when the todo points at a
    # planned task — then the task is what matters and the todo is just how the
    # person got here.
    task = models.ForeignKey(
        Task, null=True, blank=True, on_delete=models.CASCADE, related_name="issues"
    )
    # SET_NULL, not CASCADE: ticking a line off your day and clearing it should
    # never quietly delete a bug report somebody filed against it.
    todo = models.ForeignKey(
        "daily.Todo", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="issues",
    )
    # What it was raised against, in words, fixed at the moment it was raised.
    # Never blank in practice — the service always writes it and a constraint
    # enforces it — because it is what the issue still means once the task or
    # todo it points at has been deleted. The column default exists only so the
    # migration that adds it has something to put in the rows already there.
    raised_against = models.CharField(max_length=512, default="")

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
            models.Index(fields=["todo", "state"]),
            models.Index(fields=["assignee", "state"]),
            models.Index(fields=["reported_by", "state"]),
        ]
        constraints = [
            # The invariant is that an issue always says what it was about —
            # not that the thing it was about still exists. Requiring a task or
            # a todo looked equivalent and was not: a todo is deleted routinely,
            # ``todo`` is SET_NULL so the report survives it, and an issue on a
            # bare todo would then have neither. That made deleting such a todo
            # fail outright with an integrity error. ``raised_against`` is
            # written once at creation and never cleared, so it is the thing
            # worth guaranteeing.
            models.CheckConstraint(
                condition=~models.Q(raised_against=""),
                name="issue_says_what_it_is_about",
            ),
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
    def project(self):
        """The project this belongs to, or None for an issue on a bare todo.

        A todo that points at a task reaches a project through it. A todo
        somebody typed on their own day belongs to nothing, and saying so is
        more honest than inventing a home for it.
        """
        if self.task_id and self.task:
            return self.task.milestone.project
        if self.todo_id and self.todo and self.todo.task:
            return self.todo.task.milestone.project
        return None
