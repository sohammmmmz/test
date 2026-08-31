"""A small caching layer, built to be wrong for at most a moment and never fatal.

Two ideas carry all of it.

**Versioned scopes.** Nothing here deletes a key. Every cached value is stored
under a name that embeds the current version number of each scope it was built
from, and invalidating a scope means incrementing that number — after which the
old keys are simply never asked for again and fall out on their own TTL. This
matters because the alternative, deleting by pattern, is a linear scan in Redis
and outright impossible in the local-memory fallback. Bumping is one integer
write no matter how many keys it strands.

**Fail-open.** Every call is wrapped. If Redis is unreachable, misconfigured, or
the payload will not round-trip, the caller gets a cache miss and builds the
value the slow way. A cache that takes the site down when it goes away is worse
than no cache, and on an air-gapped deployment "there is no Redis here" is a
perfectly ordinary answer.

The scope names live in ``SCOPES`` rather than being spelled inline, because a
typo in a scope name is invisible: it caches happily and never invalidates.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any, Callable, Iterable

from django.core.cache import cache

logger = logging.getLogger(__name__)

# Everything this app writes is prefixed, so pointing at a shared Redis does not
# collide with whatever else is in there.
NAMESPACE = "ml"

# A miss and a stored ``None`` are different answers, and ``cache.get`` cannot
# tell them apart. This sentinel can.
MISS = object()

# What a builder returns when its answer must not be remembered — a permission
# error, an empty state that is about to be filled in. Never stored, so it never
# has to survive a pickle.
NO_CACHE = object()


# ---------------------------------------------------------------------------
# Scopes
# ---------------------------------------------------------------------------

class SCOPES:
    """The invalidation vocabulary.

    Coarse on purpose. Finer scopes cache better and go stale in ways that are
    very hard to see, and a stale project list is a bug report that arrives
    three weeks later with no way to reproduce it. Where a scope can safely
    carry an id it takes one — ``plan:7`` is bumped by a write to project 7 and
    leaves the other projects' plans alone.
    """

    PROJECTS = "proj"      # projects, their members, repos, phase
    PLAN = "plan"          # milestones and tasks
    TODOS = "todo"         # the daily lists
    TEAMS = "team"         # teams and their membership
    PEOPLE = "people"      # user records: names, avatars, roles


def scoped(scope: str, ident: Any = None) -> str:
    return f"{scope}:{ident}" if ident is not None else scope


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

def _version_key(scope: str) -> str:
    return f"{NAMESPACE}:v:{scope}"


def version(scope: str) -> int:
    """The current version of one scope, starting at 1.

    A cache that has just been flushed reports 1 for everything, which is
    correct: every key derived from it is gone too.
    """
    try:
        got = cache.get(_version_key(scope))
        if got is None:
            # No TTL. A version that expires while the values built from it are
            # still alive would roll back to 1 and resurrect them.
            cache.set(_version_key(scope), 1, None)
            return 1
        return int(got)
    except Exception:  # noqa: BLE001 — a broken cache must not break the read
        logger.debug("cache: could not read version for %s", scope, exc_info=True)
        return 1


def bump(*scopes: str) -> None:
    """Invalidate every value derived from these scopes.

    ``incr`` rather than set-plus-one so two writers landing together cannot
    both read 4 and both write 5, leaving a stale key addressable.
    """
    for scope in scopes:
        if not scope:
            continue
        try:
            cache.incr(_version_key(scope))
        except ValueError:
            # Nothing to increment: the version has never been written, or it
            # expired. Either way 2 is safe — anything built against 1 is now
            # unreachable.
            try:
                cache.set(_version_key(scope), 2, None)
            except Exception:  # noqa: BLE001
                logger.debug("cache: could not seed version for %s", scope, exc_info=True)
        except Exception:  # noqa: BLE001
            logger.debug("cache: could not bump %s", scope, exc_info=True)


# ---------------------------------------------------------------------------
# Keys and values
# ---------------------------------------------------------------------------

def build_key(name: str, scopes: Iterable[str], parts: Iterable[Any] = ()) -> str:
    """A key that stops being addressable the moment any of its scopes moves.

    Hashed at the end because query strings and paths get into ``parts``, and
    Redis keys have a length limit that a filter-heavy URL will find.
    """
    stamp = ".".join(f"{s}={version(s)}" for s in scopes)
    body = "|".join(str(p) for p in parts)
    digest = hashlib.sha1(f"{stamp}|{body}".encode()).hexdigest()[:24]
    return f"{NAMESPACE}:{name}:{digest}"


def read(key: str) -> Any:
    try:
        got = cache.get(key, MISS)
        return got
    except Exception:  # noqa: BLE001
        logger.debug("cache: read failed for %s", key, exc_info=True)
        return MISS


def write(key: str, value: Any, ttl: int) -> None:
    try:
        cache.set(key, value, ttl)
    except Exception:  # noqa: BLE001
        # Usually an unpicklable payload — a lazy queryset, a model instance.
        # Worth a warning rather than silence: it means this key never caches
        # and nobody would otherwise notice.
        logger.warning("cache: could not store %s", key, exc_info=True)


def remember(
    name: str,
    scopes: Iterable[str],
    ttl: int,
    build: Callable[[], Any],
    parts: Iterable[Any] = (),
) -> Any:
    """Return the cached value, or build it and cache it.

    ``build`` must return something that survives a pickle round-trip — plain
    dicts, lists and scalars. Serialize before calling this, not after.
    """
    scopes = list(scopes)
    key = build_key(name, scopes, parts)
    got = read(key)
    if got is not MISS:
        return got
    value = build()
    if value is NO_CACHE:
        return value
    write(key, value, ttl)
    return value


# ---------------------------------------------------------------------------
# Throttles
# ---------------------------------------------------------------------------

def claim(name: str, ttl: int) -> bool:
    """True at most once per ``ttl`` seconds for a given name.

    ``add`` is atomic in Redis, so of two page loads arriving together exactly
    one gets the work. Used to keep an expensive refresh — reconciling against
    GitLab — from running once per render.

    Fails *open*: if the cache is unreachable this returns True every time, so
    the throttled work still happens. Slow beats not running.
    """
    try:
        return bool(cache.add(f"{NAMESPACE}:claim:{name}", 1, ttl))
    except Exception:  # noqa: BLE001
        logger.debug("cache: could not claim %s", name, exc_info=True)
        return True


def release(name: str) -> None:
    """Give up a claim early, so a failed attempt does not hold the window."""
    try:
        cache.delete(f"{NAMESPACE}:claim:{name}")
    except Exception:  # noqa: BLE001
        pass
