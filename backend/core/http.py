"""Making a DRF read cacheable without changing what it returns.

Both helpers here cache the *serialized* payload — plain lists and dicts on
their way to JSON — rather than querysets or model instances. That is the only
form that survives a trip through Redis, and it means the saving is the whole
cost of the read: the queries, the serializer, the per-object properties that
each run their own count.

Every key varies by user. These endpoints answer "what may this person see",
and a cache that forgets to ask that is a data leak rather than a stale page.
"""

from __future__ import annotations

import functools

from rest_framework.response import Response
from rest_framework.utils.serializer_helpers import ReturnDict, ReturnList

from .cache import NO_CACHE, remember


def plain(value):
    """Strip DRF's wrappers so the payload can be pickled.

    ``serializer.data`` is a ``ReturnList``/``ReturnDict`` — a list or dict that
    also carries a reference back to the serializer, which holds the request,
    which holds a database connection. Pickling that either fails outright or
    quietly stores far more than intended. Nothing below this point is anything
    but the JSON-shaped values.
    """
    if isinstance(value, (ReturnList, list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, (ReturnDict, dict)):
        return {k: plain(v) for k, v in value.items()}
    return value


def _vary_on(request) -> tuple:
    """What makes one person's answer different from another's.

    The query string is sorted so ``?a=1&b=2`` and ``?b=2&a=1`` share a key
    instead of computing the same answer twice.
    """
    user_id = getattr(request.user, "id", None)
    params = sorted(request.query_params.items())
    return (user_id, tuple(params))


def cached_read(name: str, scopes, ttl_setting: str):
    """Cache a GET function view.

    Only a 200 is ever stored. Several of these views answer 403 or 404 from
    inside the body of the function — "owners only", "no such person" — and a
    cache that kept the payload but not the status would hand the next caller a
    permission error rendered as a successful response. So the status travels
    with the payload, and anything that is not a plain success is passed through
    uncached: those are cheap to produce and dangerous to remember.

    ``ttl_setting`` is the *name* of a setting rather than a number, so the TTL
    is read per call and importing this module does not require settings to be
    configured yet.
    """
    def decorate(view):
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            from django.conf import settings

            if request.method != "GET":
                return view(request, *args, **kwargs)

            def build():
                response = view(request, *args, **kwargs)
                if response.status_code != 200:
                    return NO_CACHE
                return plain(response.data)

            payload = remember(
                name,
                list(scopes),
                getattr(settings, ttl_setting),
                build,
                parts=(*_vary_on(request), *args, *sorted(kwargs.items())),
            )
            if payload is NO_CACHE:
                # Not cacheable. Run it again for real, so the caller gets the
                # actual status and body rather than a stand-in.
                return view(request, *args, **kwargs)
            return Response(payload)
        return wrapper
    return decorate


class CachedListMixin:
    """Cache the list endpoint of a ViewSet.

    Only ``list``. Retrieve is left alone: it is one row by primary key, which
    is already the cheapest query in the app, and caching it would add a scope
    to keep honest for no measurable gain.

    Set ``cache_scopes`` and ``cache_ttl_setting`` on the view. A view that sets
    neither is not cached, which is the safe default for a subclass that forgot.
    """

    cache_scopes: tuple = ()
    cache_ttl_setting: str = "CACHE_TTL_LIST"

    def list(self, request, *args, **kwargs):
        from django.conf import settings

        if not self.cache_scopes:
            return super().list(request, *args, **kwargs)

        def build():
            response = super(CachedListMixin, self).list(request, *args, **kwargs)
            if response.status_code != 200:
                return NO_CACHE
            return plain(response.data)

        payload = remember(
            f"list:{self.__class__.__name__}",
            list(self.cache_scopes),
            getattr(settings, self.cache_ttl_setting),
            build,
            parts=_vary_on(request),
        )
        if payload is NO_CACHE:
            return super().list(request, *args, **kwargs)
        return Response(payload)
