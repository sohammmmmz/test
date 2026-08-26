"""Where the tokens live in the browser.

Both cookies are httpOnly, so no script on the page can read them; the Next.js
server is the only thing that sees their values. SameSite=Lax is the other
half — the browser will not attach them to a cross-site POST.
"""

from django.conf import settings

from .authentication import ACCESS_COOKIE, REFRESH_COOKIE


def _common() -> dict:
    return {
        "httponly": True,
        "secure": settings.SESSION_COOKIE_SECURE,
        "samesite": settings.SESSION_COOKIE_SAMESITE,
        "path": "/",
    }


def set_auth_cookies(response, pair):
    response.set_cookie(
        ACCESS_COOKIE, pair.access,
        max_age=settings.JWT_ACCESS_TTL_SECONDS, **_common()
    )
    response.set_cookie(
        REFRESH_COOKIE, pair.refresh,
        max_age=settings.JWT_REFRESH_TTL_SECONDS, **_common()
    )
    return response


def clear_auth_cookies(response):
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        response.delete_cookie(name, path="/", samesite=settings.SESSION_COOKIE_SAMESITE)
    return response
