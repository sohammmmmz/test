from django.urls import path

from . import views

urlpatterns = [
    path("windows", views.windows, name="report-windows"),
    path("preview", views.preview, name="report-preview"),
    path("export", views.export, name="report-export"),
]
