"""The notification tab.

Deliberately cheap. The bell polls this, so it is one indexed count and a small
page of rows, and it is never cached — a notification the person cannot see for
another sixty seconds is the one thing in this app that must not be stale.
"""

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer, NotificationWriteSerializer
from .services import notify, unread_count

PAGE = 40


def _mine(request):
    return Notification.objects.filter(user=request.user)


@api_view(["GET", "POST"])
def notifications(request):
    if request.method == "POST":
        form = NotificationWriteSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        note = notify(request.user, form.validated_data.pop("title"), **form.validated_data)
        return Response(NotificationSerializer(note).data, status=status.HTTP_201_CREATED)

    rows = list(_mine(request)[:PAGE])
    return Response({
        "unread": unread_count(request.user),
        "items": NotificationSerializer(rows, many=True).data,
    })


@api_view(["POST", "DELETE"])
def notification_detail(request, notification_id: int):
    note = _mine(request).filter(pk=notification_id).first()
    if note is None:
        return Response({"detail": "No such notification."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        note.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # A retry that worked resolves the row; anything else just marks it seen.
    if request.data.get("resolved"):
        note.resolve()
    else:
        note.mark_read()
    return Response(NotificationSerializer(note).data)


@api_view(["POST"])
def read_all(request):
    _mine(request).filter(read_at__isnull=True).update(read_at=timezone.now())
    return Response({"unread": 0})


@api_view(["DELETE"])
def clear(request):
    """Empty the tab, except anything still unresolved and unread.

    "Clear all" that discards a failure the person has not looked at yet loses
    the only record that it happened.
    """
    _mine(request).filter(read_at__isnull=False).delete()
    return Response({"unread": unread_count(request.user)})
