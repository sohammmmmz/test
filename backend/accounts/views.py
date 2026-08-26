"""Sign in, finish your profile, sign out.

One way in: GitLab OAuth, ending in a JWT pair held in httpOnly cookies.
Assigning an issue needs a real GitLab account id, so there is deliberately no
second door — somebody who existed only in this database could never be given
work.
"""

import logging

from django.utils import timezone
from urllib.parse import urlencode

from django.conf import settings
from django.shortcuts import redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from gitlab_api.exceptions import GitLabError
from gitlab_api.oauth import (
    build_authorize_url,
    consume_state,
    exchange_code_for_token,
    is_oauth_configured,
    upsert_user_from_token,
)

from .authentication import REFRESH_COOKIE
from .cookies import clear_auth_cookies, set_auth_cookies
from .models import Department, Role
from .serializers import OnboardingSerializer, UserSerializer
from .tokens import REFRESH, TokenError, decode, issue_pair, revoke_session, rotate

logger = logging.getLogger(__name__)


def _signed_in(user, *, http_status=status.HTTP_200_OK):
    response = Response(UserSerializer(user).data, status=http_status)
    return set_auth_cookies(response, issue_pair(user))


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def auth_config(request):
    """What the sign-in screen needs to explain itself.

    Reachable while signed out, and the place an anonymous visitor first gets a
    CSRF cookie — cookie-authenticated writes are checked against it.
    """
    return Response({
        "gitlab_url": settings.GITLAB_URL,
        "oauth_configured": is_oauth_configured(),
        "service_token_configured": bool(settings.GITLAB_SERVICE_TOKEN),
        "group_configured": bool(settings.GITLAB_GROUP_ID),
        "roles": [{"value": v, "label": l} for v, l in Role.choices],
        "departments": [{"value": v, "label": l} for v, l in Department.choices],
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def gitlab_login(request):
    try:
        url, _state = build_authorize_url(
            redirect_to=request.GET.get("next", ""),
            invite_token=request.GET.get("invite", ""),
        )
    except GitLabError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return redirect(url)


def _redeem_invite(token: str, user) -> bool:
    """Put an invited person on the team they were invited to.

    Returns True when the invite was good and this actually joined them. Their
    role is set here rather than asked for: the link says which team and which
    side of it they are on, so the onboarding step has nothing left to ask.
    """
    if not token:
        return False

    from teams.models import TeamInvite

    invite = TeamInvite.objects.filter(token=token).select_related("team").first()
    if invite is None or not invite.is_usable:
        logger.info("Invite %s was not usable; signing in without joining", token[:8])
        return False

    invite.redeem(user)

    # The link already says which side of the team they are on, so the role is
    # settled and onboarding has only the department left to ask.
    if not user.role:
        user.role = Role.MEMBER
        user.save(update_fields=["role"])
    return True


def _land(**params):
    """Send the browser to the app's own callback page.

    Always the same page, whether the flow ran in a popup or a full tab: that
    page is the only thing that can tell which, so it either messages the
    window that opened it or navigates on its own.
    """
    return redirect(f"{settings.FRONTEND_URL}/auth/callback?{urlencode(params)}")


@api_view(["GET"])
@permission_classes([AllowAny])
def gitlab_callback(request):
    error = request.GET.get("error")
    if error:
        return _land(status="error", error=request.GET.get("error_description", error))

    code, raw_state = request.GET.get("code"), request.GET.get("state")
    if not code or not raw_state:
        return _land(status="error", error="missing_code_or_state")

    try:
        state = consume_state(raw_state)
        payload = exchange_code_for_token(code)
        user, _created = upsert_user_from_token(payload)
    except GitLabError as exc:
        logger.warning("GitLab sign-in failed: %s", exc)
        return _land(status="error", error="oauth_failed")

    joined = _redeem_invite(state.invite_token, user)

    destination = state.redirect_to or "/"
    if not destination.startswith("/"):
        # Never redirect off-site on the strength of a query parameter.
        destination = "/"
    if not user.is_onboarded:
        # Still owes us a department. The role is already set if they came
        # through an invite, so that screen asks less of them.
        destination = "/welcome"
    elif joined:
        # Invited people are members; they have no dashboard to land on.
        destination = "/my-day"
    elif not user.is_owner and destination == "/":
        # Members have no dashboard; sending them to one bounces them straight
        # back out again.
        destination = "/my-day"

    # The cookies ride on this redirect, so the opener sees a signed-in session
    # the moment the popup lands.
    return set_auth_cookies(_land(status="ok", next=destination), issue_pair(user))


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def token_refresh(request):
    """Trade the refresh cookie for a fresh pair.

    Runs without authentication classes on purpose: the caller's access token
    has usually just expired, which is why they are here.
    """
    raw = request.COOKIES.get(REFRESH_COOKIE) or request.data.get("refresh") or ""
    if not raw:
        return Response({"detail": "Not signed in."}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        user, pair = rotate(raw)
    except TokenError as exc:
        response = Response({"detail": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)
        # The cookie is spent either way; leaving it would make the browser
        # retry a token that can never work again.
        return clear_auth_cookies(response)

    return set_auth_cookies(Response(UserSerializer(user).data), pair)


@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """The signed-in user, and the CSRF cookie the app's writes need."""
    return Response(UserSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def complete_onboarding(request):
    """Record role and department. The one endpoint open to a half-set-up user."""
    serializer = OnboardingSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    request.user.complete_onboarding(**serializer.validated_data)
    return Response(UserSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def sign_out(request):
    """Permissive on purpose: signing out has to work with an expired token."""
    raw = request.COOKIES.get(REFRESH_COOKIE, "")
    if raw:
        try:
            revoke_session(decode(raw, expected=REFRESH)["sid"])
        except (TokenError, KeyError):
            pass  # Already dead, or never valid. Nothing to end.
    return clear_auth_cookies(Response(status=status.HTTP_204_NO_CONTENT))
