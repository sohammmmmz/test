"""GitLab OAuth 2.0 authorization-code flow.

This is a confidential server-side application, so it uses the plain
authorization-code flow with a client secret — PKCE exists for public clients
that cannot hold one, and adds nothing here.

The refresh path is the subtle part. Exchanging a refresh token invalidates
both the old access token and the old refresh token, so if the process dies
between "GitLab issued a new pair" and "the new pair is saved", that user's
connection is orphaned with nothing to retry. The write is therefore the last
thing that happens, under a row lock.
"""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from accounts.models import GitLabToken, OAuthState, User

from .client import GitLabClient
from .exceptions import GitLabAuthError, GitLabError
from .gateway import user_client

logger = logging.getLogger(__name__)

STATE_TTL_SECONDS = 600


def is_oauth_configured() -> bool:
    return bool(settings.GITLAB_OAUTH_CLIENT_ID and settings.GITLAB_OAUTH_CLIENT_SECRET)


def build_authorize_url(redirect_to: str = "", invite_token: str = "") -> tuple[str, OAuthState]:
    if not is_oauth_configured():
        raise GitLabError("GitLab sign-in is not configured on this server.")

    state = OAuthState.objects.create(
        state=secrets.token_urlsafe(32),
        redirect_to=redirect_to or "",
        invite_token=invite_token or "",
        expires_at=timezone.now() + timedelta(seconds=STATE_TTL_SECONDS),
    )
    query = urlencode({
        "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
        "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "state": state.state,
        "scope": settings.GITLAB_OAUTH_SCOPES,
    })
    return f"{settings.GITLAB_URL}/oauth/authorize?{query}", state


def consume_state(raw_state: str) -> OAuthState:
    try:
        state = OAuthState.objects.get(state=raw_state)
    except OAuthState.DoesNotExist as exc:
        raise GitLabAuthError("Unrecognised sign-in attempt.") from exc
    if not state.is_usable:
        raise GitLabAuthError("This sign-in link has expired or already been used.")
    state.consumed_at = timezone.now()
    state.save(update_fields=["consumed_at"])
    return state


def _token_request(payload: dict) -> dict:
    response = requests.post(
        f"{settings.GITLAB_URL}/oauth/token",
        data=payload,
        timeout=settings.GITLAB_TIMEOUT,
        headers={"Accept": "application/json"},
    )
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:400]
        raise GitLabAuthError(f"GitLab token endpoint returned {response.status_code}: {detail}")
    return response.json()


def exchange_code_for_token(code: str) -> dict:
    return _token_request({
        "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
        "client_secret": settings.GITLAB_OAUTH_CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
    })


def _expires_at(payload: dict):
    expires_in = payload.get("expires_in")
    return timezone.now() + timedelta(seconds=int(expires_in)) if expires_in else None


@transaction.atomic
def upsert_user_from_token(payload: dict) -> tuple[User, bool]:
    """Create or update the local user from a fresh token. Returns (user, created)."""
    account = GitLabClient.for_user(payload["access_token"]).get_current_user()

    user, created = User.objects.update_or_create(
        gitlab_user_id=account["id"],
        defaults={
            "username": account.get("username") or f"gl-{account['id']}",
            "email": account.get("email") or f"{account['id']}@users.noreply.gitlab.com",
            "first_name": (account.get("name") or "").split(" ")[0][:150],
            "last_name": " ".join((account.get("name") or "").split(" ")[1:])[:150],
            "gitlab_username": account.get("username", ""),
            "gitlab_avatar_url": account.get("avatar_url") or "",
            "gitlab_web_url": account.get("web_url") or "",
            "last_login_at": timezone.now(),
        },
    )
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])

    GitLabToken.objects.update_or_create(
        user=user,
        defaults={
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token", ""),
            "scope": payload.get("scope", ""),
            "expires_at": _expires_at(payload),
            "is_revoked": False,
        },
    )
    return user, created


def refresh_user_token(token: GitLabToken) -> GitLabToken:
    """Exchange the refresh token for a new pair, serialized on the row.

    Two concurrent requests both refreshing would otherwise race, and the loser
    would persist a refresh token GitLab has already invalidated.
    """
    with transaction.atomic():
        locked = GitLabToken.objects.select_for_update().get(pk=token.pk)

        if not locked.is_expired():
            return locked  # Another request refreshed while we waited.
        if locked.is_revoked or not locked.refresh_token:
            raise GitLabAuthError(f"{locked.user} needs to reconnect their GitLab account.")

        try:
            payload = _token_request({
                "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
                "client_secret": settings.GITLAB_OAUTH_CLIENT_SECRET,
                "refresh_token": locked.refresh_token,
                "grant_type": "refresh_token",
                "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
            })
        except GitLabAuthError:
            locked.is_revoked = True
            locked.save(update_fields=["is_revoked"])
            raise

        locked.access_token = payload["access_token"]
        # A rotation that omits a new refresh token would leave the old, now
        # dead, one in place — keep whatever GitLab returned.
        locked.refresh_token = payload.get("refresh_token", locked.refresh_token)
        locked.expires_at = _expires_at(payload)
        locked.scope = payload.get("scope", locked.scope)
        locked.is_revoked = False
        locked.save()
        return locked


def get_user_client(user: User):
    """A client acting as ``user``, refreshing first if the token has aged out."""
    try:
        token = user.gitlab_token
    except GitLabToken.DoesNotExist as exc:
        raise GitLabAuthError(f"{user} has not connected a GitLab account.") from exc
    if token.is_revoked:
        raise GitLabAuthError(f"{user} needs to reconnect their GitLab account.")
    if token.is_expired():
        token = refresh_user_token(token)
    return user_client(token.access_token)
