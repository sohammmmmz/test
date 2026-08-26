"""Choosing which GitLab to talk to.

Every call site asks for a client here rather than importing one directly, so
demo mode is a single decision made in one place instead of a conditional
scattered through the services.
"""

from django.conf import settings

from .client import GitLabClient
from .demo import DemoGitLabClient


def service_client():
    """The credential that performs every write."""
    if settings.DEMO_MODE:
        return DemoGitLabClient.for_service()
    return GitLabClient.for_service()


def user_client(access_token: str):
    """A client acting as one person, for visibility checks only."""
    if settings.DEMO_MODE:
        return DemoGitLabClient.for_user(access_token)
    return GitLabClient.for_user(access_token)


def is_configured() -> bool:
    """True when real GitLab work is possible."""
    return bool(settings.GITLAB_SERVICE_TOKEN) or settings.DEMO_MODE
