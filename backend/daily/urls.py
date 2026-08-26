from django.urls import path

from . import views

urlpatterns = [
    path("my-day", views.my_day, name="my-day"),
    path("my-alerts", views.my_alerts, name="my-alerts"),
    path("todos", views.create_todo, name="todo-create"),
    path("todos/<int:todo_id>", views.todo_detail, name="todo-detail"),
    path("people/<int:user_id>/day", views.person_day, name="person-day"),
    path("people/<int:user_id>/history", views.todo_history, name="todo-history"),
    path("meeting/<int:team_id>", views.meeting_today, name="meeting-today"),
    path("meeting/<int:team_id>/history", views.meeting_history, name="meeting-history"),
    path("meeting/action/<int:meeting_id>", views.meeting_action, name="meeting-action"),
]
