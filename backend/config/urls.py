from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from projects.dashboard import dashboard


def healthz(_request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz),
    path("api/auth/", include("accounts.urls")),
    path("api/teams/", include("teams.urls")),
    path("api/projects/", include("projects.urls")),
    path("api/planning/", include("planning.urls")),
    path("api/daily/", include("daily.urls")),
    path("api/dashboard", dashboard, name="dashboard"),
]
