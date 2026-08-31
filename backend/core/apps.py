from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "core"
    verbose_name = "Cache and invalidation"

    def ready(self):
        # Importing for the signal registrations, which is the whole point of
        # the module. Kept here rather than at module scope so the app registry
        # is populated before any model is imported.
        from . import invalidation  # noqa: F401
