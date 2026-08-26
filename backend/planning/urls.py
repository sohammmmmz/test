from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("milestones", views.MilestoneViewSet, basename="milestone")
router.register("tasks", views.TaskViewSet, basename="task")

urlpatterns = [
    path("reconcile/<int:project_id>", views.reconcile, name="planning-reconcile"),
    *router.urls,
]
