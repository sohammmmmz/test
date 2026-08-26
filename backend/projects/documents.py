"""Committing the BRD and technical document to the documentation branch.

Uploaded through the app, stored in git. Branch creation is not a separate
step: passing ``start_branch`` on the commit creates the branch as part of the
same commit, so "make the branch if missing, then add the file" cannot
half-fail and leave an empty branch behind.
"""

from __future__ import annotations

import base64
import hashlib
import logging

from django.conf import settings
from django.utils import timezone

from gitlab_api.exceptions import GitLabError
from gitlab_api.gateway import service_client

from .models import Document, DocumentKind, Project

logger = logging.getLogger(__name__)

DOC_DIRECTORY = "docs"

# Text goes up as UTF-8 so it diffs properly in git; everything else base64.
TEXT_EXTENSIONS = {".md", ".txt", ".rst", ".adoc", ".csv", ".json", ".yaml", ".yml"}


class DocumentUploadError(Exception):
    """The document could not be committed, with a reason for the uploader."""


def _safe_name(filename: str, kind: str) -> str:
    """A predictable path, so the readiness check knows where to look."""
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    suffix = "".join(c for c in suffix if c.isalnum() or c == ".")[:12]
    stem = "BRD" if kind == DocumentKind.BRD else "TECHNICAL"
    return f"{stem}{suffix}"


def upload_document(project: Project, *, kind: str, filename: str, raw: bytes,
                    uploaded_by=None, content_type: str = "") -> Document:
    if not raw:
        raise DocumentUploadError(f"{filename} is empty.")

    limit = settings.MAX_DOCUMENT_UPLOAD_BYTES
    if len(raw) > limit:
        # GitLab throttles requests over 20MB heavily, so the cap is enforced
        # before the call rather than discovered during it.
        raise DocumentUploadError(
            f"{filename} is {len(raw) / 1_048_576:.1f}MB, over the "
            f"{limit / 1_048_576:.0f}MB limit for repository uploads."
        )

    repo = getattr(project, "repo", None)
    if repo is None:
        raise DocumentUploadError("This project has no repository.")

    path = f"{DOC_DIRECTORY}/{_safe_name(filename, kind)}"
    content_hash = hashlib.sha256(raw).hexdigest()

    existing = Document.objects.filter(project=project, kind=kind).first()
    if existing and existing.content_hash == content_hash:
        # Same bytes as last time: a commit saying nothing changed is noise.
        return existing

    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if suffix in TEXT_EXTENSIONS:
        try:
            content, encoding = raw.decode("utf-8"), "text"
        except UnicodeDecodeError:
            content, encoding = base64.b64encode(raw).decode("ascii"), "base64"
    else:
        content, encoding = base64.b64encode(raw).decode("ascii"), "base64"

    client = service_client()
    branch = repo.docs_branch
    branch_exists = client.branch_exists(repo.gitlab_project_id, branch)

    actions = []
    if not branch_exists:
        actions.append({
            "action": "create",
            "file_path": f"{DOC_DIRECTORY}/README.md",
            "content": f"# {project.name} — documentation\n",
        })
    # `create` fails when the path exists and `update` fails when it does not,
    # so the action depends on what the branch currently holds.
    action = "create"
    if branch_exists and client.file_exists(repo.gitlab_project_id, path, branch):
        action = "update"
    actions.append({
        "action": action, "file_path": path, "content": content, "encoding": encoding,
    })

    try:
        result = client.create_commit(
            repo.gitlab_project_id,
            branch=branch,
            commit_message=f"Add {DocumentKind(kind).label.lower()}",
            actions=actions,
            # Only on first creation: passing start_branch for a branch that
            # exists makes GitLab reject the commit.
            start_branch=repo.default_branch if not branch_exists else None,
        )
    except GitLabError as exc:
        raise DocumentUploadError(f"GitLab refused the commit: {exc}") from exc

    if not repo.documentation_branch_ready:
        repo.documentation_branch_ready = True
        repo.save(update_fields=["documentation_branch_ready"])

    document, _ = Document.objects.update_or_create(
        project=project, kind=kind,
        defaults={
            "filename": filename,
            "repo_path": path,
            "content_type": content_type,
            "size_bytes": len(raw),
            "content_hash": content_hash,
            "commit_sha": (result or {}).get("id", ""),
            "uploaded_by": uploaded_by,
            "uploaded_at": timezone.now(),
        },
    )
    return document
