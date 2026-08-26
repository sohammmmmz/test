from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("", views.TeamViewSet, basename="team")

urlpatterns = [
    path("directory/", views.directory, name="people-directory"),
    *router.urls,
]
