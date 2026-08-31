"""Settings for the GitLab-backed project manager.

Everything deployment-specific comes from the environment. The one structural
decision worth stating here: there is no Celery. The only recurring work in
this product is building each person's todo list for the day, and that is done
lazily the first time the day is asked for (see ``daily.services``). A cron
that can silently not run is a worse fit than materialising on read.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["*"]),
)

_env_file = BASE_DIR.parent / ".env"
if _env_file.exists():
    env.read_env(str(_env_file))

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-insecure-change-me")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "accounts",
    "gitlab_api",
    "teams",
    "projects",
    "planning",
    "daily",
    "notifications",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://postgres:postgres@localhost:5432/pms",
    )
}

# --------------------------------------------------------------------------
# Cache
#
# Redis when there is one, local memory when there is not, and the app has to
# behave the same either way. That is not a convenience: on an air-gapped
# install "we did not deploy a Redis" is a normal answer, and a product that
# only works with one would be undeployable there.
#
# The local-memory fallback is per-process, so with more than one worker each
# has its own copy and its own version counters. Values still expire on their
# TTL and every read path stays correct, but two workers can briefly disagree
# about how fresh something is. Run Redis for anything with more than one
# person in it.
#
# Short timeouts on purpose. A cache that hangs is worse than one that is
# missing, because every request waits for it; ``core.cache`` treats a failed
# call as a miss, and a miss has to be cheap to discover.
# --------------------------------------------------------------------------

REDIS_URL = env("REDIS_URL", default="")

try:  # pragma: no cover - import probe
    import redis as _redis  # noqa: F401
    _HAS_REDIS = True
except ImportError:
    _HAS_REDIS = False

if REDIS_URL and _HAS_REDIS:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": env("REDIS_KEY_PREFIX", default=""),
            "OPTIONS": {
                "socket_connect_timeout": env.int("REDIS_CONNECT_TIMEOUT", default=2),
                "socket_timeout": env.int("REDIS_TIMEOUT", default=2),
            },
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "morning-ledger",
            # Comfortably more than the number of distinct keys this app has,
            # so the fallback does not start culling and behaving unlike Redis.
            "OPTIONS": {"MAX_ENTRIES": 5000, "CULL_FREQUENCY": 4},
        }
    }

# How long a cached read may be stale if nothing invalidates it first. Writes
# bump their scope immediately (see ``core.invalidation``), so these are the
# backstop for changes this app never sees — someone editing a milestone in
# GitLab's own UI — not the primary freshness mechanism.
CACHE_TTL_DASHBOARD = env.int("CACHE_TTL_DASHBOARD", default=60)
CACHE_TTL_LIST = env.int("CACHE_TTL_LIST", default=120)
CACHE_TTL_PLAN = env.int("CACHE_TTL_PLAN", default=120)
CACHE_TTL_DAY = env.int("CACHE_TTL_DAY", default=30)

# Reconciling against GitLab is two or more HTTP round trips to a server that
# may be across a VPN. Opening a project asks for it, and so does every refresh
# after every small edit on that screen, so it is throttled to once per window
# per project rather than run per render.
RECONCILE_THROTTLE_SECONDS = env.int("RECONCILE_THROTTLE_SECONDS", default=90)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("TIME_ZONE", default="UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --------------------------------------------------------------------------
# Auth: GitLab OAuth in, JWT pair out, held in httpOnly cookies.
# --------------------------------------------------------------------------

JWT_SIGNING_KEY = env("JWT_SIGNING_KEY", default="") or SECRET_KEY
JWT_ACCESS_TTL_SECONDS = env.int("JWT_ACCESS_TTL_SECONDS", default=30 * 60)
JWT_REFRESH_TTL_SECONDS = env.int("JWT_REFRESH_TTL_SECONDS", default=30 * 24 * 3600)

SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=False)
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=False)
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=["http://localhost:3000"])
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:3000"])
CORS_ALLOW_CREDENTIALS = True

FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.permissions.IsOnboarded"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
}

# --------------------------------------------------------------------------
# GitLab
#
# Two credentials, deliberately separate. A user's OAuth token proves who they
# are and what they can see. The service token owns every write, because OAuth
# access tokens live two hours and refreshing rotates them — no shared resource
# can depend on one person staying signed in.
# --------------------------------------------------------------------------

GITLAB_URL = env("GITLAB_URL", default="https://gitlab.com").rstrip("/")
GITLAB_API_URL = f"{GITLAB_URL}/api/v4"

GITLAB_OAUTH_CLIENT_ID = env("GITLAB_OAUTH_CLIENT_ID", default="")
GITLAB_OAUTH_CLIENT_SECRET = env("GITLAB_OAUTH_CLIENT_SECRET", default="")
GITLAB_OAUTH_REDIRECT_URI = env(
    "GITLAB_OAUTH_REDIRECT_URI",
    default="http://localhost:8000/api/auth/gitlab/callback",
)
# `api` is required: read_api cannot create milestones, issues, branches or
# memberships.
GITLAB_OAUTH_SCOPES = env("GITLAB_OAUTH_SCOPES", default="api read_user")

GITLAB_SERVICE_TOKEN = env("GITLAB_SERVICE_TOKEN", default="")
GITLAB_GROUP_ID = env("GITLAB_GROUP_ID", default="")

GITLAB_TIMEOUT = env.int("GITLAB_TIMEOUT", default=30)
GITLAB_PER_PAGE = env.int("GITLAB_PER_PAGE", default=100)
GITLAB_DEFAULT_BRANCH = env("GITLAB_DEFAULT_BRANCH", default="main")
GITLAB_DEFAULT_VISIBILITY = env("GITLAB_DEFAULT_VISIBILITY", default="private")
DOCUMENTATION_BRANCH = env("DOCUMENTATION_BRANCH", default="documentation")
MAX_DOCUMENT_UPLOAD_BYTES = env.int("MAX_DOCUMENT_UPLOAD_BYTES", default=20 * 1024 * 1024)

# Access level granted to a project member on the repository. Developer.
MEMBER_ACCESS_LEVEL = env.int("MEMBER_ACCESS_LEVEL", default=30)

# --------------------------------------------------------------------------
# Working rhythm
# --------------------------------------------------------------------------

# Mon=0 … Sun=6. Todo lists are not built for days nobody is expected to work,
# so a Monday carries Friday's unfinished work rather than three days of it.
WORKING_WEEKDAYS = env.list("WORKING_WEEKDAYS", cast=int, default=[0, 1, 2, 3, 4])
# A todo that has been carried this many days starts showing its age.
TODO_STALE_AFTER_DAYS = env.int("TODO_STALE_AFTER_DAYS", default=3)

# What one person comfortably holds at once, used to express bandwidth in the
# reports as a percentage rather than a raw count. A heuristic, and named as one
# — the reports say what it is measured against so nobody mistakes it for a
# measurement of the person.
CAPACITY_OPEN_ITEMS = env.int("CAPACITY_OPEN_ITEMS", default=8)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"v": {"format": "{levelname} {asctime} {name} {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "v"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
    "loggers": {"django.db.backends": {"level": "WARNING", "propagate": True}},
}
