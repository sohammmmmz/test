"""A stand-in for GitLab, so the product can be driven before credentials exist.

This is not a mock in the testing sense — it is a working local substitute that
lets every screen be used end to end with no OAuth application and no group
token. It mirrors the shape of the payloads the real client returns and keeps
its own ids, because the rest of the app already stores everything it needs;
GitLab's job in the real flow is mostly to hand back identifiers.

Turned on with ``DEMO_MODE=true``. Never in production: nothing here reaches a
real repository, so work "written to GitLab" exists only in this database.
"""

from __future__ import annotations

import itertools
import threading
from datetime import date

from django.conf import settings

_lock = threading.Lock()
_counters: dict[str, itertools.count] = {}


def _next(kind: str) -> int:
    """Monotonic ids per kind, so demo data never collides with itself."""
    with _lock:
        if kind not in _counters:
            _counters[kind] = itertools.count(_seed(kind))
        return next(_counters[kind])


def _seed(kind: str) -> int:
    """Start above whatever is already stored, so a restart keeps ids unique."""
    from django.apps import apps

    lookups = {
        "project": ("projects", "GitLabRepo", "gitlab_project_id"),
        "milestone": ("planning", "Milestone", "gitlab_id"),
        "issue": ("planning", "Task", "gitlab_id"),
    }
    if kind not in lookups:
        return 9000
    app_label, model_name, field = lookups[kind]
    try:
        model = apps.get_model(app_label, model_name)
        highest = model.objects.order_by(f"-{field}").values_list(field, flat=True).first()
    except Exception:
        highest = None
    return int(highest or 9000) + 1


def _today() -> str:
    return date.today().isoformat()


class DemoGitLabClient:
    """Implements the surface of :class:`gitlab_api.client.GitLabClient`."""

    token_kind = "demo"

    @classmethod
    def for_service(cls, **_kwargs) -> DemoGitLabClient:
        return cls()

    @classmethod
    def for_user(cls, _access_token: str, **_kwargs) -> DemoGitLabClient:
        return cls()

    # -- users -------------------------------------------------------------

    def get_current_user(self) -> dict:
        uid = _next("user")
        return {
            "id": uid,
            "username": f"demo-user-{uid}",
            "name": "Demo User",
            "email": f"demo-user-{uid}@example.com",
            "avatar_url": "",
            "web_url": f"{settings.GITLAB_URL}/demo-user-{uid}",
        }

    def find_user_by_username(self, username: str) -> dict | None:
        return {"id": _next("user"), "username": username, "name": username}

    # -- projects ----------------------------------------------------------

    def get_project(self, project) -> dict:
        return self._project_payload(
            project if isinstance(project, int) else _next("project"),
            str(project).rsplit("/", 1)[-1],
        )

    def create_project(self, name: str, *, path: str, namespace_id=None,
                       description: str = "") -> dict:
        return self._project_payload(_next("project"), path, name=name,
                                     description=description)

    def delete_project(self, project_id: int) -> None:
        return None

    @staticmethod
    def _project_payload(project_id: int, path: str, *, name: str = "",
                         description: str = "") -> dict:
        namespace = "demo-group"
        return {
            "id": project_id,
            "name": name or path,
            "path": path,
            "path_with_namespace": f"{namespace}/{path}",
            "description": description,
            "web_url": f"{settings.GITLAB_URL}/{namespace}/{path}",
            "ssh_url_to_repo": f"git@demo:{namespace}/{path}.git",
            "http_url_to_repo": f"{settings.GITLAB_URL}/{namespace}/{path}.git",
            "default_branch": settings.GITLAB_DEFAULT_BRANCH,
            "visibility": settings.GITLAB_DEFAULT_VISIBILITY,
            "namespace": {"id": 1, "full_path": namespace},
            "created_at": _today(),
        }

    # -- branches / files --------------------------------------------------

    def list_branches(self, project_id: int) -> list[dict]:
        return [{"name": settings.GITLAB_DEFAULT_BRANCH, "default": True}]

    def create_branch(self, project_id: int, *, branch: str, ref: str) -> dict:
        return {"name": branch, "default": False, "commit": {"id": f"demo{_next('sha'):08d}"}}

    def branch_exists(self, project_id: int, branch: str) -> bool:
        return branch == settings.GITLAB_DEFAULT_BRANCH

    def file_exists(self, project_id: int, file_path: str, ref: str) -> bool:
        return False

    def create_commit(self, project_id: int, *, branch: str, commit_message: str,
                      actions: list[dict], start_branch: str | None = None) -> dict:
        return {"id": f"demo{_next('sha'):08d}", "message": commit_message}

    # -- members -----------------------------------------------------------

    def list_members(self, project_id: int) -> list[dict]:
        return []

    def add_member(self, project_id: int, *, user_id: int, access_level: int) -> dict:
        return {"id": user_id, "access_level": access_level}

    def remove_member(self, project_id: int, user_id: int) -> None:
        return None

    # -- milestones --------------------------------------------------------

    def list_milestones(self, project_id: int) -> list[dict]:
        return []

    def create_milestone(self, project_id: int, *, title: str, description: str = "",
                         start_date=None, due_date=None) -> dict:
        mid = _next("milestone")
        return {
            "id": mid, "iid": mid, "project_id": project_id,
            "title": title, "description": description, "state": "active",
            "start_date": _str_date(start_date), "due_date": _str_date(due_date),
            "web_url": f"{settings.GITLAB_URL}/-/milestones/{mid}",
        }

    def update_milestone(self, project_id: int, milestone_id: int, **fields) -> dict:
        state = "closed" if fields.get("state_event") == "close" else "active"
        return {
            "id": milestone_id, "iid": milestone_id, "project_id": project_id,
            "title": fields.get("title", ""), "description": fields.get("description", ""),
            "state": state,
            "start_date": _str_date(fields.get("start_date")),
            "due_date": _str_date(fields.get("due_date")),
        }

    def delete_milestone(self, project_id: int, milestone_id: int) -> None:
        return None

    # -- issues ------------------------------------------------------------

    def list_issues(self, project_id: int, *, updated_after=None) -> list[dict]:
        return []

    def create_issue(self, project_id: int, *, title: str, description: str = "",
                     milestone_id=None, assignee_id=None, due_date=None,
                     labels=None) -> dict:
        gid = _next("issue")
        return {
            "id": gid, "iid": gid, "project_id": project_id,
            "title": title, "description": description, "state": "opened",
            "milestone": {"id": milestone_id} if milestone_id else None,
            "assignee": {"id": assignee_id} if assignee_id else None,
            "due_date": _str_date(due_date),
            "labels": list(labels or []),
            "web_url": f"{settings.GITLAB_URL}/-/issues/{gid}",
        }

    def update_issue(self, project_id: int, issue_iid: int, **fields) -> dict:
        state = "opened"
        if fields.get("state_event") == "close":
            state = "closed"
        return {
            "id": issue_iid, "iid": issue_iid, "project_id": project_id,
            "title": fields.get("title", ""), "state": state,
            "assignee": ({"id": fields["assignee_id"]}
                         if fields.get("assignee_id") else None),
            "due_date": _str_date(fields.get("due_date")),
        }


def _str_date(value) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return value[:10]
    return value.strftime("%Y-%m-%d") if hasattr(value, "strftime") else str(value)
