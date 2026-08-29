from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import Milestone, Task


class TaskSerializer(serializers.ModelSerializer):
    assignee = UserSerializer(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    project_id = serializers.IntegerField(source="milestone.project_id", read_only=True)
    project_name = serializers.CharField(source="milestone.project.name", read_only=True)
    milestone_title = serializers.CharField(source="milestone.title", read_only=True)

    class Meta:
        model = Task
        fields = ["id", "gitlab_iid", "title", "description", "state", "assignee",
                  "due_date", "labels", "web_url", "is_overdue", "milestone",
                  "milestone_title", "project_id", "project_name", "closed_at",
                  "created_at"]


class MilestoneSerializer(serializers.ModelSerializer):
    tasks = TaskSerializer(many=True, read_only=True)
    progress = serializers.SerializerMethodField()
    is_overdue = serializers.BooleanField(read_only=True)
    days_remaining = serializers.IntegerField(read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Milestone
        fields = ["id", "project", "project_name", "gitlab_iid", "title", "description",
                  "state", "start_date", "due_date", "web_url", "is_inherited", "tasks", "progress",
                  "is_overdue", "days_remaining", "created_at"]

    def get_progress(self, milestone):
        return milestone.progress()


class MilestoneWriteSerializer(serializers.Serializer):
    project = serializers.IntegerField()
    title = serializers.CharField(max_length=512)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    start_date = serializers.DateField(required=False, allow_null=True)
    # A milestone without a due date is a label, not a timeline — and the
    # readiness check would still report the project as unplanned.
    due_date = serializers.DateField()


class MilestoneUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=512, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    state = serializers.ChoiceField(choices=Milestone.State.choices, required=False)


class TaskWriteSerializer(serializers.Serializer):
    milestone = serializers.IntegerField()
    title = serializers.CharField(max_length=512)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    labels = serializers.ListField(child=serializers.CharField(), required=False, default=list)


class TaskUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=512, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    state = serializers.ChoiceField(choices=Task.State.choices, required=False)
