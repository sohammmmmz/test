"""DRF authentication from a JWT carried in an httpOnly cookie.

The cookie rather than an Authorization header is deliberate: the Next.js
server talks to Django on the reader's behalf, and a token held in JavaScript
would be reachable by any script on the page. The header form still works so
tests and curl have a way in.

A cookie is sent by the browser automatically, which is the precondition for
CSRF — so cookie-authenticated writes are held to Django's CSRF check. A bearer
header is not sent automatically and is exempt.
"""

from django.contrib.auth import get_user_model
from django.middleware.csrf import CsrfViewMiddleware
from rest_framework import authentication, exceptions

from .tokens import ACCESS, TokenError, decode

User = get_user_model()

ACCESS_COOKIE = "pms_access"
REFRESH_COOKIE = "pms_refresh"


class _CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        return reason


class JWTAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        raw, from_cookie = self._raw_token(request)
        if not raw:
            return None

        try:
            claims = decode(raw, expected=ACCESS)
        except TokenError as exc:
            # An expired access token is ordinary — the frontend refreshes and
            # retries. It must read as 401, not fall through to a permission
            # check that would report something misleading.
            raise exceptions.AuthenticationFailed(str(exc)) from exc

        try:
            user = User.objects.get(pk=claims["sub"])
        except (User.DoesNotExist, ValueError, TypeError) as exc:
            raise exceptions.AuthenticationFailed("Account no longer exists.") from exc

        if not user.is_active:
            raise exceptions.AuthenticationFailed("Account is disabled.")

        if from_cookie:
            self._enforce_csrf(request)

        return (user, claims)

    def authenticate_header(self, request):
        # Without this DRF answers 403 where it means 401, and the frontend
        # cannot tell "signed out" from "signed in but not allowed".
        return self.keyword

    def _raw_token(self, request) -> tuple[str, bool]:
        header = authentication.get_authorization_header(request).split()
        if header and header[0].lower() == self.keyword.lower().encode():
            if len(header) != 2:
                raise exceptions.AuthenticationFailed("Malformed Authorization header.")
            return header[1].decode(), False
        return request.COOKIES.get(ACCESS_COOKIE, ""), True

    def _enforce_csrf(self, request) -> None:
        check = _CSRFCheck(lambda r: None)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f"CSRF failed: {reason}")
