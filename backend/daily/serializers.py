from rest_framework import serializers

from accounts.serializers import UserSerializer
from planning.serializers import TaskSerializer

from .models import Meeting, MeetingNote, Todo


class TodoSerializer(serializers.ModelSerializer):
    is_done = serializers.BooleanField(read_only=True)
    is_claimed = serializers.BooleanField(read_only=True)
    status = serializers.CharField(read_only=True)
    is_stale = serializers.BooleanField(read_only=True)
    age_days = serializers.IntegerField(read_only=True)
    task = TaskSerializer(read_only=True)
    user_name = serializers.CharField(source="user.display_name", read_only=True)
    # Who said what, so the screen can label a tick "marked by Ana" rather than
    # leaving the reader to guess which end of the review it came from.
    claimed_by_name = serializers.CharField(
        source="claimed_by.display_name", read_only=True, default=None
    )
    closed_by_name = serializers.CharField(
        source="closed_by.display_name", read_only=True, default=None
    )

    class Meta:
        model = Todo
        fields = ["id", "user", "user_name", "date", "title", "notes", "task",
                  "source", "status", "is_done", "done_at", "closed_by_name",
                  "is_claimed", "claimed_at", "claimed_by_name",
                  "is_stale", "age_days",
                  "carry_count", "first_added_on", "created_at"]


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
