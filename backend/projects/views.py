"""Projects: the repository-backed unit of work."""

import logging

from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import status, viewsets
from django.conf import settings
from rest_framework.decorators import action, api_view
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from accounts.permissions import IsOwner
from gitlab_api.exceptions import GitLabError
from gitlab_api.gateway import service_client
from teams.models import Team

from .documents import DocumentUploadError, upload_document
from .models import GitLabRepo, Project
from .serializers import (
    DocumentSerializer,
    DocumentUploadSerializer,
    ProjectCreateSerializer,
    ProjectDetailSerializer,
    ProjectListSerializer,
    ProjectUpdateSerializer,
)
from .services import (
    ProjectCreationError,
    add_member,
    create_project,
    delete_project,
    remove_member,
)

logger = logging.getLogger(__name__)
User = get_user_model()


@api_view(["GET"])
def available_repos(request):
    """Repositories that could back a project, and which are already taken.

    Searched with the service token rather than the caller's, because that is
    the credential that will do the writing — everything listed here is
    guaranteed to work once linked, with no per-repository setup.
    """
    if not settings.GITLAB_SERVICE_TOKEN:
        return Response({
            "repos": [],
            "detail": "GITLAB_SERVICE_TOKEN is not set, so no repositories can be listed.",
        })

    query = (request.query_params.get("search") or "").strip()
    try:
        rows = service_client().search_projects(query)
    except GitLabError as exc:
        return Response({"repos": [], "detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

    taken = {
        r["gitlab_project_id"]: r["project__name"]
        for r in GitLabRepo.objects.values("gitlab_project_id", "project__name")
    }
    return Response({
        "query": query,
        "repos": [
            {
                "gitlab_project_id": r["id"],
                "name": r.get("name", ""),
                "path_with_namespace": r.get("path_with_namespace", ""),
                "web_url": r.get("web_url", ""),
                "default_branch": r.get("default_branch"),
                "visibility": r.get("visibility", ""),
                "last_activity_at": r.get("last_activity_at"),
                "linked_to": taken.get(r["id"]),
            }
            for r in rows
        ],
    })


@api_view(["GET"])
def repo_branches(request):
    """Branches on a repository, so the docs branch can be picked not typed.

    A linked repository may already keep its documentation somewhere; choosing
    that branch is better than making a second one beside it.
    """
    reference = request.query_params.get("repo")
    if not reference:
        return Response({"branches": []})

    try:
        target = int(reference)
    except (TypeError, ValueError):
        target = reference

    try:
        rows = service_client().list_branches(target)
    except GitLabError as exc:
        return Response({"branches": [], "detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

    return Response({
        "default": settings.DOCUMENTATION_BRANCH,
        "branches": [
            {"name": b.get("name", ""), "is_default": bool(b.get("default"))}
            for b in rows
        ],
    })


class ProjectViewSet(viewsets.ModelViewSet):
    """Owners manage their projects; members read the ones they are on."""

    serializer_class = ProjectDetailSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return super().get_permissions()
        return [IsOwner()]

    def get_queryset(self):
        user = self.request.user
        base = (
            Project.objects.select_related("repo", "owner", "team")
            .prefetch_related("members__user", "documents")
        )
        if user.is_owner:
            # An owner sees their own projects, plus any they happen to work on.
            return base.filter(Q(owner=user) | Q(members__user=user)).distinct()
        return base.filter(members__user=user).distinct()

    def get_serializer_class(self):
        if self.action == "list":
            return ProjectListSerializer
        if self.action in ("update", "partial_update"):
            return ProjectUpdateSerializer
        return ProjectDetailSerializer

    def create(self, request, *args, **kwargs):
        """Create the project, which creates the repository behind it."""
        serializer = ProjectCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        team = None
        if data.get("team"):
            team = Team.objects.filter(pk=data["team"], owner=request.user).first()
            if team is None:
                return Response(
                    {"detail": "That team is not yours."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        members = list(User.objects.filter(pk__in=data.get("member_ids") or []))

        try:
            project, warnings = create_project(
                name=data["name"],
                owner=request.user,
                description=data.get("description", ""),
                team=team,
                member_users=members,
                status=data.get("status") or None,
                started_on=data.get("started_on"),
                target_end_on=data.get("target_end_on"),
                repo_reference=(data.get("repo_reference") or "").strip() or None,
                documentation_branch=(data.get("documentation_branch") or "").strip() or None,
            )
        except ProjectCreationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except GitLabError as exc:
            logger.exception("Project creation failed")
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        payload = ProjectDetailSerializer(project).data
        payload["warnings"] = warnings
        return Response(payload, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        project = self.get_object()
        name = project.name
        # Deleting the repository takes a deliberate second decision.
        delete_repo = str(request.query_params.get("delete_repository", "")).lower() == "true"
        result = delete_project(project, delete_repository=delete_repo)
        return Response({"deleted": name, **result})

    @action(detail=True, methods=["post"], url_path="members")
    def add_project_member(self, request, pk=None):
        project = self.get_object()
        user = User.objects.filter(pk=request.data.get("user_id")).first()
        if user is None:
            return Response({"detail": "No such person."}, status=status.HTTP_400_BAD_REQUEST)

        warnings = add_member(project, user)
        payload = ProjectDetailSerializer(project).data
        payload["warnings"] = warnings
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"members/(?P<user_id>\d+)")
    def remove_project_member(self, request, pk=None, user_id=None):
        project = self.get_object()
        user = User.objects.filter(pk=user_id).first()
        if user is not None:
            remove_member(project, user)
        return Response(ProjectDetailSerializer(project).data)

    @action(
        detail=True, methods=["get", "post"], url_path="documents",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def documents(self, request, pk=None):
        """List the project's documents, or commit one to the docs branch."""
        project = self.get_object()

        if request.method == "GET":
            return Response(DocumentSerializer(project.documents.all(), many=True).data)

        serializer = DocumentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]

        try:
            document = upload_document(
                project,
                kind=serializer.validated_data["kind"],
                filename=upload.name,
                raw=upload.read(),
                uploaded_by=request.user,
                content_type=getattr(upload, "content_type", "") or "",
            )
        except DocumentUploadError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)
