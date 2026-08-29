"""GitLab REST v4 client.

Two credentials, never mixed. The **service** token (a group access token with
the ``api`` scope) performs every write this app makes — repositories,
branches, members, milestones, issues. A **user** token proves who somebody is
and what they can see, and is used for nothing else, because OAuth access
tokens live two hours and refreshing rotates them.
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

import requests
from django.conf import settings

from .exceptions import (
    GitLabAuthError,
    GitLabConflict,
    GitLabError,
    GitLabForbidden,
    GitLabInsufficientScope,
    GitLabNotFound,
    GitLabValidationError,
)

logger = logging.getLogger(__name__)

RETRYABLE = {429, 500, 502, 503, 504}


def encode_path(path: str) -> str:
    """URL-encode ``namespace/project`` for use as an :id path segment."""
    return quote(str(path).strip("/"), safe="")


class GitLabClient:
    def __init__(self, token: str, *, token_kind: str = "service", session=None):
        self.api_url = settings.GITLAB_API_URL
        self.token = token
        self.token_kind = token_kind
        self.session = session or requests.Session()

    @classmethod
    def for_service(cls, **kwargs) -> GitLabClient:
        if not settings.GITLAB_SERVICE_TOKEN:
            raise GitLabError(
                "GITLAB_SERVICE_TOKEN is not configured. Creating repositories, "
                "milestones and issues all require the service credential."
            )
        return cls(settings.GITLAB_SERVICE_TOKEN, token_kind="service", **kwargs)

    @classmethod
    def for_user(cls, access_token: str, **kwargs) -> GitLabClient:
        return cls(access_token, token_kind="user", **kwargs)

    # -- transport ---------------------------------------------------------

    @property
    def _headers(self) -> dict[str, str]:
        # Group/personal access tokens use PRIVATE-TOKEN; OAuth tokens use
        # Bearer. Sending the wrong one yields a confusing 401.
        if self.token_kind == "user":
            return {"Authorization": f"Bearer {self.token}"}
        return {"PRIVATE-TOKEN": self.token}

    def request(self, method: str, path: str, *, params=None, json=None, raw=False):
        url = path if path.startswith("http") else f"{self.api_url}/{path.lstrip('/')}"
        attempt = 0

        while True:
            attempt += 1
            try:
                response = self.session.request(
                    method, url, headers=self._headers, params=params,
                    json=json, timeout=settings.GITLAB_TIMEOUT,
                )
            except requests.RequestException as exc:
                if attempt > 3:
                    raise GitLabError(f"Network error calling {method} {url}: {exc}") from exc
                self._backoff(attempt)
                continue

            if response.status_code in RETRYABLE and attempt <= 3:
                self._backoff(attempt, response)
                continue
            if response.status_code >= 400:
                self._raise(response, method, url)
            return response if raw else self._decode(response)

    @staticmethod
    def _backoff(attempt: int, response=None):
        delay = None
        if response is not None:
            header = response.headers.get("Retry-After")
            if header:
                try:
                    delay = float(header)
                except ValueError:
                    delay = None
        if delay is None:
            # Jitter so a burst of calls does not retry in lockstep.
            delay = min(2 ** (attempt - 1), 8) + random.uniform(0, 0.4)
        logger.warning("GitLab retry in %.1fs (attempt %s)", delay, attempt)
        time.sleep(delay)

    @staticmethod
    def _decode(response):
        if response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError:
            return response.content

    def _raise(self, response, method: str, url: str):
        try:
            payload = response.json()
            detail = payload.get("message") or payload.get("error") or payload
        except ValueError:
            payload, detail = None, response.text[:400]

        status = response.status_code
        message = f"{method} {url}: {detail}"

        if status == 401:
            raise GitLabAuthError(message, status_code=status, payload=payload)
        if status == 403:
            # GitLab reports a missing token scope as 403 with
            # "insufficient_scope" — that needs a new token, not new
            # permissions, so it is worth telling apart.
            haystack = f"{detail} {response.headers.get('WWW-Authenticate', '')}".lower()
            if "insufficient_scope" in haystack:
                raise GitLabInsufficientScope(message, status_code=status, payload=payload)
            raise GitLabForbidden(message, status_code=status, payload=payload)
        if status == 404:
            raise GitLabNotFound(message, status_code=status, payload=payload)
        if status == 409:
            raise GitLabConflict(message, status_code=status, payload=payload)
        if status in (400, 422):
            raise GitLabValidationError(message, status_code=status, payload=payload)
        raise GitLabError(message, status_code=status, payload=payload)

    def paginate(self, path: str, *, params=None, max_pages: int = 100) -> Iterator[dict]:
        params = dict(params or {})
        params["per_page"] = settings.GITLAB_PER_PAGE
        page = 1
        while page <= max_pages:
            params["page"] = page
            response = self.request("GET", path, params=params, raw=True)
            items = self._decode(response) or []
            if not isinstance(items, list):
                raise GitLabError(f"Expected a list from {path}")
            yield from items
            if len(items) < params["per_page"]:
                return
            page += 1

    def get_list(self, path: str, **kwargs) -> list[dict]:
        return list(self.paginate(path, **kwargs))

    # -- users -------------------------------------------------------------

    def get_current_user(self) -> dict:
        return self.request("GET", "/user")

    def find_user_by_username(self, username: str) -> dict | None:
        rows = self.request("GET", "/users", params={"username": username}) or []
        return rows[0] if rows else None

    # -- projects ----------------------------------------------------------

    def search_projects(self, query: str = "", limit: int = 20) -> list[dict]:
        """Repositories this credential can write to.

        One request with `per_page` rather than a paged walk: this runs on every
        keystroke, so GitLab does the filtering and the response stays bounded.
        Enumerating a whole account and filtering locally is what makes a
        picker feel slow.

        `min_access_level=30` (Developer) because anything less cannot take the
        commits this app makes — offering a repository we could not write to
        would only fail later, at project creation.
        """
        params: dict[str, Any] = {
            "membership": True,
            "min_access_level": 30,
            "order_by": "last_activity_at",
            "sort": "desc",
            "simple": True,
            "archived": False,
            "per_page": limit,
        }
        if query:
            params["search"] = query
            # Lets "acme/apollo" match on the namespace as well as the name.
            params["search_namespaces"] = True
        result = self.request("GET", "/projects", params=params)
        return result if isinstance(result, list) else []

    def get_project(self, project: str | int) -> dict:
        ident = project if isinstance(project, int) else encode_path(project)
        return self.request("GET", f"/projects/{ident}")

    def create_project(self, name: str, *, path: str, namespace_id=None,
                       description: str = "") -> dict:
        """Create a repository, initialised so it has a usable default branch.

        ``initialize_with_readme`` is not optional: without it GitLab creates a
        project with no branches at all, and the very next step — cutting a
        branch per member off the default branch — has no ref to work from.
        """
        body: dict[str, Any] = {
            "name": name,
            "path": path,
            "description": description,
            "visibility": settings.GITLAB_DEFAULT_VISIBILITY,
            "initialize_with_readme": True,
            "default_branch": settings.GITLAB_DEFAULT_BRANCH,
        }
        if namespace_id:
            body["namespace_id"] = namespace_id
        return self.request("POST", "/projects", json=body)

    def delete_project(self, project_id: int) -> None:
        self.request("DELETE", f"/projects/{project_id}")

    # -- branches / files --------------------------------------------------

    def list_branches(self, project_id: int) -> list[dict]:
        return self.get_list(f"/projects/{project_id}/repository/branches")

    def create_branch(self, project_id: int, *, branch: str, ref: str) -> dict:
        return self.request(
            "POST", f"/projects/{project_id}/repository/branches",
            params={"branch": branch, "ref": ref},
        )

    def branch_exists(self, project_id: int, branch: str) -> bool:
        try:
            self.request(
                "GET", f"/projects/{project_id}/repository/branches/{encode_path(branch)}"
            )
            return True
        except GitLabNotFound:
            return False

    def file_exists(self, project_id: int, file_path: str, ref: str) -> bool:
        try:
            self.request(
                "GET", f"/projects/{project_id}/repository/files/{encode_path(file_path)}",
                params={"ref": ref},
            )
            return True
        except GitLabNotFound:
            return False

    def create_commit(self, project_id: int, *, branch: str, commit_message: str,
                      actions: list[dict], start_branch: str | None = None) -> dict:
        """Commit several file actions at once.

        Passing ``start_branch`` for a branch that does not exist creates it as
        part of the same commit, so "make the docs branch, then add the BRD" is
        one atomic call rather than a sequence that can half-fail.
        """
        body: dict[str, Any] = {
            "branch": branch,
            "commit_message": commit_message,
            "actions": actions,
        }
        if start_branch:
            body["start_branch"] = start_branch
        return self.request("POST", f"/projects/{project_id}/repository/commits", json=body)

    # -- members -----------------------------------------------------------

    def list_members(self, project_id: int, *, inherited: bool = True) -> list[dict]:
        """Who is on the repository.

        ``inherited`` includes people who get access through the group. That is
        the honest answer to "who can push", but the wrong one for "who did
        somebody put on this project" — for a group of twenty it would place all
        twenty on every repository in it.
        """
        path = f"/projects/{project_id}/members/all" if inherited else f"/projects/{project_id}/members"
        return self.get_list(path)

    def add_member(self, project_id: int, *, user_id: int, access_level: int) -> dict:
        return self.request(
            "POST", f"/projects/{project_id}/members",
            json={"user_id": user_id, "access_level": access_level},
        )

    def remove_member(self, project_id: int, user_id: int) -> None:
        self.request("DELETE", f"/projects/{project_id}/members/{user_id}")

    # -- milestones --------------------------------------------------------

    def list_milestones(self, project_id: int, *, include_ancestors: bool = True) -> list[dict]:
        """Milestones a project's work can be filed under.

        Ancestors included: a team that plans at the group level has no project
        milestones at all, and reading only the project's own would report an
        empty plan for work that is visibly there. (``include_parent_milestones``
        is the deprecated spelling of the same thing.)
        """
        params = {"include_ancestors": "true"} if include_ancestors else None
        return self.get_list(f"/projects/{project_id}/milestones", params=params)

    def create_milestone(self, project_id: int, *, title: str, description: str = "",
                         start_date=None, due_date=None) -> dict:
        body: dict[str, Any] = {"title": title, "description": description}
        if start_date:
            body["start_date"] = _date(start_date)
        if due_date:
            body["due_date"] = _date(due_date)
        return self.request("POST", f"/projects/{project_id}/milestones", json=body)

    def update_milestone(self, project_id: int, milestone_id: int, **fields) -> dict:
        body = {k: (_date(v) if k.endswith("_date") and v else v) for k, v in fields.items()}
        return self.request(
            "PUT", f"/projects/{project_id}/milestones/{milestone_id}", json=body
        )

    def delete_milestone(self, project_id: int, milestone_id: int) -> None:
        self.request("DELETE", f"/projects/{project_id}/milestones/{milestone_id}")

    # -- tasks -------------------------------------------------------------
    #
    # A task here is a GitLab *work item of type task*, not an issue. They share
    # one REST endpoint — /issues carries every work item type, selected with
    # issue_type — which is why the paths below still read "issues".
    #
    # Keeping them apart matters to the person using GitLab: the Issues tab
    # stays theirs, for bugs somebody filed, and planning done in this tool
    # lands under Tasks where it belongs. A task takes milestone_id directly,
    # so the Milestone -> Task hierarchy needs no parent link — which is just as
    # well, since REST cannot make a task the child of an issue.

    TASK_TYPE = "task"

    def list_tasks(self, project_id: int, *, updated_after=None,
                   issue_types: tuple[str, ...] | list[str] | None = None) -> list[dict]:
        """Everything on the project's work item list.

        Fetched **unfiltered**, and narrowed here rather than with ``issue_type``
        on the query. This has to work against whatever GitLab is on the box,
        and the versions disagree: work item types did not always exist, the
        filter value did not always exist, and a server that does not recognise
        a query parameter is as likely to ignore it as to reject it. Asking for
        everything and choosing locally cannot silently return nothing.

        What actually separates planning from noise is the **milestone**, not the
        type — see reconcile_project. So nothing is filtered by default, and an
        item with no milestone is dropped there rather than here.

        ``issue_types`` narrows it for a project that wants only tasks read. An
        item whose type GitLab did not report is kept either way: an older server
        has no opinion about types, and discarding its work would be discarding
        the whole plan.
        """
        params: dict[str, Any] = {"scope": "all", "state": "all"}
        if updated_after is not None:
            params["updated_after"] = updated_after.isoformat()

        wanted = set(issue_types) if issue_types else None
        rows: list[dict] = []
        for row in self.paginate(f"/projects/{project_id}/issues", params=params):
            kind = row.get("issue_type")
            if wanted is not None and kind is not None and kind not in wanted:
                continue
            rows.append(row)
        return rows

    def create_task(self, project_id: int, *, title: str, description: str = "",
                    milestone_id=None, assignee_id=None, due_date=None,
                    labels=None) -> dict:
        body: dict[str, Any] = {
            "title": title,
            "description": description,
            "issue_type": self.TASK_TYPE,
        }
        if milestone_id:
            body["milestone_id"] = milestone_id
        # Free tier takes a single assignee_id; assignee_ids is Premium.
        if assignee_id:
            body["assignee_id"] = assignee_id
        if due_date:
            body["due_date"] = _date(due_date)
        if labels:
            body["labels"] = ",".join(labels)
        return self.request("POST", f"/projects/{project_id}/issues", json=body)

    def update_task(self, project_id: int, task_iid: int, **fields) -> dict:
        body = {k: (_date(v) if k.endswith("_date") and v else v) for k, v in fields.items()}
        return self.request("PUT", f"/projects/{project_id}/issues/{task_iid}", json=body)

    def convert_to_task(self, project_id: int, task_iid: int) -> dict:
        """Turn an existing issue into a task, leaving everything else alone."""
        return self.update_task(project_id, task_iid, issue_type=self.TASK_TYPE)


def _date(value) -> str:
    """GitLab date fields want YYYY-MM-DD."""
    if isinstance(value, str):
        return value[:10]
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)
