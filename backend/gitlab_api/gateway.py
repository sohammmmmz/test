"""Choosing which credential talks to GitLab.

Call sites ask here rather than importing a client directly, so the split
between the two credentials is made in one place: the service token performs
every write, and a user's OAuth token is only ever used to act as that person.
"""

from django.conf import settings

from .client import GitLabClient


def service_client() -> GitLabClient:
    """The credential that performs every write."""
    return GitLabClient.for_service()


def user_client(access_token: str) -> GitLabClient:
    """A client acting as one person, for visibility checks only."""
    return GitLabClient.for_user(access_token)


def is_configured() -> bool:
    """True when GitLab work is possible at all."""
    return bool(settings.GITLAB_SERVICE_TOKEN)
