from django.urls import path

from . import views

urlpatterns = [
    path("config", views.auth_config, name="auth-config"),
    path("me", views.me, name="auth-me"),
    path("onboarding", views.complete_onboarding, name="auth-onboarding"),
    path("refresh", views.token_refresh, name="auth-refresh"),
    path("sign-out", views.sign_out, name="auth-sign-out"),
    path("demo", views.demo_sign_in, name="auth-demo"),
    path("gitlab/login", views.gitlab_login, name="gitlab-login"),
    path("gitlab/callback", views.gitlab_callback, name="gitlab-callback"),
]
