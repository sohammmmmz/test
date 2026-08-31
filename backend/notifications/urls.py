from django.urls import path

from . import views

urlpatterns = [
    path("", views.notifications, name="notifications"),
    path("read-all", views.read_all, name="notifications-read-all"),
    path("clear", views.clear, name="notifications-clear"),
    path("<int:notification_id>", views.notification_detail, name="notification-detail"),
]
