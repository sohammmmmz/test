from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import Document, GitLabRepo, Project, ProjectMember


class GitLabRepoSerializer(serializers.ModelSerializer):
    class Meta:
        model = GitLabRepo
        fields = [
            "gitlab_project_id", "path_with_namespace", "web_url",
            "http_url_to_repo", "default_branch", "visibility",
            "documentation_branch_ready",
        ]


class ProjectMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ProjectMember
        fields = ["id", "user", "branch_name", "access_level",
                  "synced_to_gitlab", "sync_error"]


class DocumentSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    uploaded_by_name = serializers.CharField(
        source="uploaded_by.display_name", read_only=True, default=None
    )

    class Meta:
        model = Document
        fields = ["id", "kind", "kind_display", "filename", "repo_path",
                  "size_bytes", "commit_sha", "uploaded_by_name", "uploaded_at"]


class ProjectListSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    repo_path = serializers.CharField(source="repo.path_with_namespace",
                                      read_only=True, default=None)
    repo_url = serializers.CharField(source="repo.web_url", read_only=True, default=None)
    team_name = serializers.CharField(source="team.name", read_only=True, default=None)
    progress = serializers.SerializerMethodField()
    readiness = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(source="members.count", read_only=True)

    class Meta:
        model = Project
        fields = ["id", "name", "slug", "description", "status", "owner",
                  "team_name", "repo_path", "repo_url", "started_on",
                  "target_end_on", "progress", "readiness", "member_count",
                  "created_at"]

    def get_progress(self, project):
        return project.progress()

    def get_readiness(self, project):
        return project.readiness()


class ProjectDetailSerializer(ProjectListSerializer):
    repo = GitLabRepoSerializer(read_only=True)
    members = ProjectMemberSerializer(many=True, read_only=True)
    documents = DocumentSerializer(many=True, read_only=True)

    class Meta(ProjectListSerializer.Meta):
        fields = ProjectListSerializer.Meta.fields + ["repo", "members", "documents"]


class ProjectCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    team = serializers.IntegerField(required=False, allow_null=True)
    member_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )
    status = serializers.CharField(required=False, allow_blank=True)
    started_on = serializers.DateField(required=False, allow_null=True)
    target_end_on = serializers.DateField(required=False, allow_null=True)


class ProjectUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["name", "description", "status", "team", "started_on", "target_end_on"]


class DocumentUploadSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["brd", "technical"])
    file = serializers.FileField()
