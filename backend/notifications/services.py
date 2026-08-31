"""Writing a notification from server-side code.

Kept out of the views so anything can raise one — a service, a management
command, a failure handler — without importing DRF.
"""

from __future__ import annotations

from .models import Notification, NotificationKind

# One person's list is a list, not an archive. Older rows are trimmed on write
# rather than by a job that has to be scheduled and can silently stop.
KEEP_PER_USER = 100


def notify(
    user,
    title: str,
    *,
    body: str = "",
    kind: str = NotificationKind.FAILED,
    target_url: str = "",
    dedupe_key: str = "",
    retry_method: str = "",
    retry_path: str = "",
    retry_body=None,
) -> Notification:
    """File one notification, folding a repeat of the same failure into its row.

    Repeats update rather than accumulate: pressing a broken button six times is
    one problem. The row is re-opened when it recurs — a failure that had been
    read and then happened again is unread news.
    """
    fields = {
        "kind": kind,
        "title": title,
        "body": body,
        "target_url": target_url,
        "retry_method": retry_method,
        "retry_path": retry_path,
        "retry_body": retry_body,
    }

    if dedupe_key:
        existing = (
            Notification.objects.filter(
                user=user, dedupe_key=dedupe_key, resolved_at__isnull=True
            )
            .order_by("-updated_at")
            .first()
        )
        if existing is not None:
            for name, value in fields.items():
                setattr(existing, name, value)
            existing.attempts += 1
            existing.read_at = None
            existing.save()
            return existing

    note = Notification.objects.create(user=user, dedupe_key=dedupe_key, **fields)
    _trim(user)
    return note


def _trim(user) -> None:
    ids = list(
        Notification.objects.filter(user=user)
        .order_by("-updated_at")
        .values_list("id", flat=True)[KEEP_PER_USER:]
    )
    if ids:
        Notification.objects.filter(pk__in=ids).delete()


def unread_count(user) -> int:
    return Notification.objects.filter(user=user, read_at__isnull=True).count()
