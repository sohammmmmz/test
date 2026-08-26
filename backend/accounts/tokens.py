"""JWT issuing and refresh-token rotation.

A short access token (30 minutes) carries the identity, so authenticating a
request needs no database read. A long refresh token (30 days) can do exactly
one thing — mint a new pair — and is rotated every time it is used. Presenting
an already-rotated token is evidence it was copied, so the session dies rather
than the request being politely refused.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import timedelta

import jwt
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import RefreshSession, User

ALGORITHM = "HS256"
ISSUER = "gitlab-pms"
ACCESS = "access"
REFRESH = "refresh"

# A junk "sid" claim reaches the ORM as an invalid UUID rather than a missing
# row, so both failure shapes are caught in one place.
BAD_SESSION_ID = (ValidationError, ValueError, TypeError)

# Two tabs waking together both present the token they were holding. One wins
# the rotation; the other is historic through nobody's fault. Outside this
# window, a superseded token really is a copy.
GRACE_SECONDS = 30


class TokenError(Exception):
    """Any reason a presented token cannot be honoured."""


@dataclass(frozen=True)
class TokenPair:
    access: str
    refresh: str
    session: RefreshSession


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _encode(*, user: User, kind: str, jti: str, sid: str, expires_at) -> str:
    payload = {
        "sub": str(user.pk),
        "typ": kind,
        "jti": jti,
        "sid": sid,
        "iss": ISSUER,
        "iat": int(timezone.now().timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    if kind == ACCESS:
        payload["username"] = user.username
        payload["role"] = user.role
    return jwt.encode(payload, settings.JWT_SIGNING_KEY, algorithm=ALGORITHM)


def decode(token: str, *, expected: str | None = None) -> dict:
    try:
        claims = jwt.decode(
            token,
            settings.JWT_SIGNING_KEY,
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            options={"require": ["exp", "sub", "typ", "jti"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Token is not valid.") from exc

    if expected is not None and claims.get("typ") != expected:
        # A refresh token must never work as an access token; it lives far
        # longer and the short access lifetime would mean nothing.
        raise TokenError(f"Expected a {expected} token.")
    return claims


def issue_pair(user: User, *, session: RefreshSession | None = None) -> TokenPair:
    now = timezone.now()
    refresh_expires = now + timedelta(seconds=settings.JWT_REFRESH_TTL_SECONDS)
    access_expires = now + timedelta(seconds=settings.JWT_ACCESS_TTL_SECONDS)
    jti = uuid.uuid4().hex

    if session is None:
        session = RefreshSession.objects.create(
            user=user, token_hash=_hash(jti), expires_at=refresh_expires
        )
    else:
        session.previous_token_hash = session.token_hash
        session.token_hash = _hash(jti)
        session.rotated_at = now
        # Sliding expiry: daily users are never signed out, abandoned sessions
        # still die on schedule.
        session.expires_at = refresh_expires
        session.save(
            update_fields=["token_hash", "previous_token_hash", "rotated_at", "expires_at"]
        )

    sid = str(session.pk)
    return TokenPair(
        access=_encode(user=user, kind=ACCESS, jti=uuid.uuid4().hex, sid=sid,
                       expires_at=access_expires),
        refresh=_encode(user=user, kind=REFRESH, jti=jti, sid=sid,
                        expires_at=refresh_expires),
        session=session,
    )


def rotate(raw_refresh: str) -> tuple[User, TokenPair]:
    claims = decode(raw_refresh, expected=REFRESH)

    try:
        session = RefreshSession.objects.select_related("user").get(pk=claims["sid"])
    except (RefreshSession.DoesNotExist, *BAD_SESSION_ID) as exc:
        raise TokenError("Session is unknown.") from exc

    if session.revoked_at is not None:
        raise TokenError("Session has been signed out.")
    if session.expires_at <= timezone.now():
        raise TokenError("Session has expired.")

    presented = _hash(claims["jti"])
    if session.token_hash != presented and not _within_grace(session, presented):
        session.revoke()
        raise TokenError("Refresh token has already been used.")

    if not session.user.is_active:
        session.revoke()
        raise TokenError("Account is disabled.")

    return session.user, issue_pair(session.user, session=session)


def _within_grace(session: RefreshSession, presented_hash: str) -> bool:
    if not session.previous_token_hash or session.rotated_at is None:
        return False
    if session.previous_token_hash != presented_hash:
        return False
    return (timezone.now() - session.rotated_at).total_seconds() <= GRACE_SECONDS


def revoke_session(session_id: str) -> None:
    RefreshSession.objects.filter(pk=session_id, revoked_at__isnull=True).update(
        revoked_at=timezone.now()
    )
