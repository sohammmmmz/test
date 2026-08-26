from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("", views.ProjectViewSet, basename="project")

urlpatterns = [
    # Before the router: its detail route would otherwise swallow these.
    path("available-repos/", views.available_repos, name="available-repos"),
    path("repo-branches/", views.repo_branches, name="repo-branches"),
    *router.urls,
]
