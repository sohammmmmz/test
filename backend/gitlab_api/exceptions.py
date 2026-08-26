class GitLabError(Exception):
    """Anything GitLab refused to do, with the reason it gave."""

    def __init__(self, message: str, *, status_code: int | None = None, payload=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.payload = payload


class GitLabAuthError(GitLabError):
    """The credential was rejected — invalid, revoked or expired."""


class GitLabInsufficientScope(GitLabError):
    """The token is valid but lacks the `api` scope. Needs a new token."""


class GitLabForbidden(GitLabError):
    """Authenticated, but not permitted."""


class GitLabNotFound(GitLabError):
    """No such project, branch, issue or user — or it is invisible to us."""


class GitLabConflict(GitLabError):
    """Already exists."""


class GitLabValidationError(GitLabError):
    """GitLab rejected the payload."""
