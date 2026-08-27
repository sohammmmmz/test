"""The working day: todo lists, and the meeting that sets them.

A todo is not a task. A task is a GitLab issue that may take a week; a todo is
one line on one person's list for one day. A todo may point at a task, or exist
entirely on its own — "pair with Sam on the migration" is real work that will
never be an issue.

Each day gets its own rows rather than one row whose date moves, because the
owner wants to look back at what somebody's list actually said on Tuesday. An
unfinished todo is copied forward, and the copy remembers what it came from, so
a line that has been rolling for a week can say so.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone


class TodoSource(models.TextChoices):
    CARRIED = "carried", "Carried over"
    TASK = "task", "From a GitLab task"
    MEETING = "meeting", "Added in the morning meeting"
    MANUAL = "manual", "Added by hand"


class Todo(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="todos"
    )
    date = models.DateField(db_index=True)
    title = models.CharField(max_length=512)
    notes = models.TextField(blank=True)

    # Optional: the GitLab task this advances. Closing the task ticks this off.
    task = models.ForeignKey(
        "planning.Task", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="todos",
    )
    source = models.CharField(max_length=16, choices=TodoSource.choices,
                              default=TodoSource.MANUAL)

    # Completion happens in two stages, and both are kept.
    #
    # A member ticking a line off is a claim: "I have finished this." The owner
    # closing it in the morning meeting is the finding: "yes, that is done."
    # Collapsing the two into one flag would lose the thing the owner actually
    # wants to see — what was said to be finished, and whether anybody checked.
    claimed_at = models.DateTimeField(null=True, blank=True)
    claimed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="claimed_todos",
    )

    done_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="closed_todos",
    )

    # The row on the previous working day this was copied from, and how many
    # days it has been rolling. A todo that keeps moving is the finding.
    carried_from = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="carried_to"
    )
    first_added_on = models.DateField(null=True, blank=True)
    carry_count = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="created_todos",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-carry_count", "id"]
        indexes = [models.Index(fields=["user", "date"])]

    def __str__(self):
        return f"{self.user} · {self.date} · {self.title[:40]}"

    @property
    def is_done(self) -> bool:
        """Closed for good. Only an owner can put a todo in this state."""
        return self.done_at is not None

    @property
    def is_claimed(self) -> bool:
        """The person says it is finished, and nobody has confirmed it yet."""
        return self.claimed_at is not None and self.done_at is None

    @property
    def status(self) -> str:
        if self.done_at is not None:
            return "closed"
        if self.claimed_at is not None:
            return "claimed"
        return "open"

    @property
    def age_days(self) -> int:
        """How many working days this line has been carried."""
        return self.carry_count

    @property
    def is_stale(self) -> bool:
        """Rolling and nobody has said it is finished.

        A claimed line is not stale however long it sits: it is waiting on the
        owner, not on the person carrying it, and colouring it as their problem
        would be blaming the wrong end.
        """
        from django.conf import settings as dj

        if self.is_done or self.is_claimed:
            return False
        return self.carry_count >= dj.TODO_STALE_AFTER_DAYS


class MeetingStatus(models.TextChoices):
    NOT_STARTED = "not_started", "Not started"
    IN_PROGRESS = "in_progress", "In progress"
    COMPLETED = "completed", "Completed"


class Meeting(models.Model):
    """One morning meeting: one team, one day.

    Recorded rather than transient. A standup nobody can look back at is a
    conversation, not a record, and the owner asked to be able to check what
    was agreed.
    """

    team = models.ForeignKey(
        "teams.Team", on_delete=models.CASCADE, related_name="meetings"
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="run_meetings"
    )
    date = models.DateField(db_index=True)
    status = models.CharField(max_length=16, choices=MeetingStatus.choices,
                              default=MeetingStatus.NOT_STARTED)

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # Where the round has got to, so a refresh does not lose the owner's place.
    current_index = models.PositiveIntegerField(default=0)
    summary = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(fields=["team", "date"], name="uniq_meeting_per_team_day")
        ]

    def __str__(self):
        return f"{self.team.name} · {self.date}"

    @property
    def duration_minutes(self) -> int | None:
        if self.started_at and self.completed_at:
            return round((self.completed_at - self.started_at).total_seconds() / 60)
        return None


class MeetingNote(models.Model):
    """One person's turn in the round."""

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="notes")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="meeting_notes"
    )
    attended = models.BooleanField(default=True)
    blockers = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["meeting", "user"], name="uniq_note_per_person")
        ]

    def __str__(self):
        return f"{self.user} at {self.meeting}"

    @property
    def is_reviewed(self) -> bool:
        return self.reviewed_at is not None
