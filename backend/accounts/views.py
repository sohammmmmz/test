"""Sign in, finish your profile, sign out.

One way in — GitLab OAuth — ending in a JWT pair held in httpOnly cookies. Demo
mode adds a second door that skips GitLab entirely, so the product can be shown
before an OAuth application exists.
"""

import logging
import secrets

from django.conf import settings
from django.shortcuts import redirect
from django.utils import timezone
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
from .models import Department, Role, User
from .serializers import DemoSignInSerializer, OnboardingSerializer, UserSerializer
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
        "demo_mode": settings.DEMO_MODE,
        "roles": [{"value": v, "label": l} for v, l in Role.choices],
        "departments": [{"value": v, "label": l} for v, l in Department.choices],
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def gitlab_login(request):
    try:
        url, _state = build_authorize_url(redirect_to=request.GET.get("next", ""))
    except GitLabError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return redirect(url)


@api_view(["GET"])
@permission_classes([AllowAny])
def gitlab_callback(request):
    frontend = settings.FRONTEND_URL

    error = request.GET.get("error")
    if error:
        return redirect(f"{frontend}/sign-in?error={request.GET.get('error_description', error)}")

    code, raw_state = request.GET.get("code"), request.GET.get("state")
    if not code or not raw_state:
        return redirect(f"{frontend}/sign-in?error=missing_code_or_state")

    try:
        state = consume_state(raw_state)
        payload = exchange_code_for_token(code)
        user, _created = upsert_user_from_token(payload)
    except GitLabError as exc:
        logger.warning("GitLab sign-in failed: %s", exc)
        return redirect(f"{frontend}/sign-in?error=oauth_failed")

    destination = state.redirect_to or "/"
    if not destination.startswith("/"):
        # Never redirect off-site on the strength of a query parameter.
        destination = "/"
    if not user.is_onboarded:
        destination = "/welcome"

    response = redirect(f"{frontend}{destination}")
    return set_auth_cookies(response, issue_pair(user))


@api_view(["POST"])
@permission_classes([AllowAny])
def demo_sign_in(request):
    """Create a signed-in user without GitLab. Demo mode only."""
    if not settings.DEMO_MODE:
        return Response(
            {"detail": "Demo sign-in is switched off. Sign in with GitLab instead."},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = DemoSignInSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    name = data["name"].strip()
    handle = "".join(c for c in name.lower().replace(" ", "-") if c.isalnum() or c == "-")
    handle = handle or f"demo-{secrets.token_hex(3)}"

    user = User.objects.filter(gitlab_username=handle).first()
    if user is None:
        # A stable pseudo GitLab id, so demo users behave like real ones
        # everywhere downstream — assignment included.
        highest = User.objects.order_by("-gitlab_user_id").values_list(
            "gitlab_user_id", flat=True
        ).first()
        user = User.objects.create(
            username=handle,
            email=f"{handle}@demo.local",
            first_name=name.split(" ")[0][:150],
            last_name=" ".join(name.split(" ")[1:])[:150],
            gitlab_user_id=int(highest or 9000) + 1,
            gitlab_username=handle,
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])

    user.complete_onboarding(
        role=data["role"], department=data["department"],
        job_title=data.get("job_title", ""),
    )
    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at"])
    return _signed_in(user, http_status=status.HTTP_201_CREATED)


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
