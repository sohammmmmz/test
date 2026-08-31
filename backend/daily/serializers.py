from rest_framework import serializers

from accounts.serializers import UserSerializer
from planning.serializers import TaskSerializer

from .models import Meeting, MeetingNote, Todo


class TodoSerializer(serializers.ModelSerializer):
    is_done = serializers.BooleanField(read_only=True)
    status = serializers.CharField(read_only=True)
    is_stale = serializers.BooleanField(read_only=True)
    age_days = serializers.IntegerField(read_only=True)
    task = TaskSerializer(read_only=True)
    user_name = serializers.CharField(source="user.display_name", read_only=True)
    # Who said what, so the screen can label a tick "marked by Ana" rather than
    # leaving the reader to guess which end of the review it came from.
    closed_by_name = serializers.CharField(
        source="closed_by.display_name", read_only=True, default=None
    )
    open_issue_count = serializers.SerializerMethodField()

    class Meta:
        model = Todo
        fields = ["id", "user", "user_name", "date", "title", "notes", "task",
                  "source", "status", "is_done", "done_at", "closed_by_name",
                  "is_stale", "age_days", "open_issue_count",
                  "carry_count", "first_added_on", "created_at"]

    def get_open_issue_count(self, todo) -> int:
        """Counted in bulk by ``attach_issue_counts`` wherever a list is built.

        The fallback is a query per row, which is why it is a fallback: it is
        here so a screen that forgets to call the bulk helper is *slow* rather
        than silently reporting zero problems on work that has them.
        """
        counted = getattr(todo, "open_issue_count", None)
        if counted is not None:
            return counted

        from django.db.models import Q

        from planning.models import Issue

        subject = Q(todo_id=todo.pk)
        if todo.task_id:
            subject |= Q(task_id=todo.task_id)
        return Issue.objects.filter(subject, state=Issue.State.OPEN).distinct().count()


class TodoWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=512)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    date = serializers.DateField(required=False)
    user_id = serializers.IntegerField(required=False, allow_null=True)
    task_id = serializers.IntegerField(required=False, allow_null=True)


class MeetingNoteSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    is_reviewed = serializers.BooleanField(read_only=True)

    class Meta:
        model = MeetingNote
        fields = ["id", "user", "attended", "blockers", "notes",
                  "is_reviewed", "reviewed_at"]


class MeetingSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    notes = MeetingNoteSerializer(many=True, read_only=True)
    duration_minutes = serializers.IntegerField(read_only=True)

    class Meta:
        model = Meeting
        fields = ["id", "team", "team_name", "owner", "date", "status",
                  "started_at", "completed_at", "current_index", "summary",
                  "duration_minutes", "notes"]
