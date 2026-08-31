from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import Issue, Milestone, Task


class TaskSerializer(serializers.ModelSerializer):
    assignee = UserSerializer(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    # A count rather than the issues themselves: a task with forty defects
    # against it should not make the plan forty times bigger to load. The list
    # is one request away, and only when somebody opens that task.
    open_issue_count = serializers.SerializerMethodField()
    project_id = serializers.IntegerField(source="milestone.project_id", read_only=True)
    project_name = serializers.CharField(source="milestone.project.name", read_only=True)
    milestone_title = serializers.CharField(source="milestone.title", read_only=True)

    class Meta:
        model = Task
        fields = ["id", "gitlab_iid", "title", "description", "state", "assignee",
                  "due_date", "labels", "web_url", "is_overdue", "milestone",
                  "milestone_title", "work_item_type", "project_id", "project_name",
                  "open_issue_count", "closed_at", "created_at"]

    def get_open_issue_count(self, task) -> int:
        # Uses the annotation when the queryset provided one, so serializing a
        # milestone's worth of tasks is not a query each.
        cached = getattr(task, "open_issues", None)
        if cached is not None:
            return cached
        return task.issues.filter(state=Issue.State.OPEN).count()


class IssueSerializer(serializers.ModelSerializer):
    reported_by = UserSerializer(read_only=True)
    assignee = UserSerializer(read_only=True)
    is_in_gitlab = serializers.BooleanField(read_only=True)
    is_open = serializers.BooleanField(read_only=True)
    severity_display = serializers.CharField(source="get_severity_display", read_only=True)
    task_title = serializers.CharField(source="task.title", read_only=True, default=None)
    task_gitlab_iid = serializers.IntegerField(
        source="task.gitlab_iid", read_only=True, default=None
    )
    # All four can be null: an issue raised against a bare todo belongs to no
    # milestone and no project, and pretending otherwise would put it under
    # whichever project happened to be handy.
    project_id = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    milestone_id = serializers.IntegerField(
        source="task.milestone_id", read_only=True, default=None
    )
    milestone_title = serializers.CharField(
        source="task.milestone.title", read_only=True, default=None
    )

    class Meta:
        model = Issue
        fields = ["id", "task", "task_title", "task_gitlab_iid", "todo",
                  "raised_against", "title", "description",
                  "severity", "severity_display", "state", "reported_by", "assignee",
                  "gitlab_iid", "web_url", "is_linked", "is_in_gitlab", "is_open",
                  "project_id", "project_name", "milestone_id", "milestone_title",
                  "closed_at", "created_at"]

    def get_project_id(self, issue):
        project = issue.project
        return project.id if project else None

    def get_project_name(self, issue):
        project = issue.project
        return project.name if project else None


class IssueWriteSerializer(serializers.Serializer):
    """One of ``task`` or ``todo``, and the view checks that at least one came."""

    task = serializers.IntegerField(required=False, allow_null=True)
    todo = serializers.IntegerField(required=False, allow_null=True)
    title = serializers.CharField(max_length=512)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    severity = serializers.ChoiceField(
        choices=Issue.Severity.choices, required=False, default=Issue.Severity.MEDIUM
    )
    assignee_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, data):
        if not data.get("task") and not data.get("todo"):
            raise serializers.ValidationError(
                "An issue has to be raised against a task or a todo."
            )
        return data


class IssueUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=512, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    severity = serializers.ChoiceField(choices=Issue.Severity.choices, required=False)
    state = serializers.ChoiceField(choices=Issue.State.choices, required=False)
    assignee_id = serializers.IntegerField(required=False, allow_null=True)


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
