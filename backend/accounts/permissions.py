from rest_framework.permissions import BasePermission


class IsOnboarded(BasePermission):
    """Signed in, and has told us their role and department.

    The project-wide default. Half a profile means half the app cannot decide
    what to show, so everything is closed until onboarding is finished — the
    onboarding endpoint itself opts out.
    """

    message = "Finish setting up your profile first."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and user.is_onboarded)


class IsOwner(BasePermission):
    """Project owners only — creating projects, running the morning meeting."""

    message = "Only project owners can do this."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and user.is_onboarded and user.is_owner)
