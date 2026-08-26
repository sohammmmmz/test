from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("", views.TeamViewSet, basename="team")

urlpatterns = [
    # Both before the router, whose detail route would otherwise match them.
    path("directory/", views.directory, name="people-directory"),
    path("invites/<str:token>/", views.invite_details, name="invite-details"),
    *router.urls,
]
