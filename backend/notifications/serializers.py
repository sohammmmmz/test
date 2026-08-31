from rest_framework import serializers

from .models import Notification, NotificationKind


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.BooleanField(read_only=True)
    is_resolved = serializers.BooleanField(read_only=True)
    can_retry = serializers.BooleanField(read_only=True)

    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "body", "target_url", "dedupe_key", "attempts",
                  "retry_method", "retry_path", "retry_body", "is_read", "is_resolved",
                  "can_retry", "read_at", "resolved_at", "created_at", "updated_at"]


class NotificationWriteSerializer(serializers.Serializer):
    """What the browser is allowed to file against itself.

    ``retry_path`` is validated rather than trusted. It comes back to the client
    later and is fetched, so an absolute URL stored here would be a way to make
    somebody's browser call an arbitrary host carrying their session. Only a
    relative path under /api/ is accepted, and a protocol-relative "//host"
    is rejected explicitly — it passes a naive startswith("/") check and is a
    fully qualified URL.
    """

    kind = serializers.ChoiceField(
        choices=NotificationKind.choices, default=NotificationKind.FAILED
    )
    title = serializers.CharField(max_length=512)
    body = serializers.CharField(max_length=4000, required=False, allow_blank=True, default="")
    target_url = serializers.CharField(max_length=512, required=False, allow_blank=True, default="")
    dedupe_key = serializers.CharField(max_length=128, required=False, allow_blank=True, default="")
    retry_method = serializers.ChoiceField(
        choices=["POST", "PATCH", "PUT", "DELETE"], required=False, allow_blank=True, default=""
    )
    retry_path = serializers.CharField(max_length=512, required=False, allow_blank=True, default="")
    retry_body = serializers.JSONField(required=False, allow_null=True, default=None)

    def validate_retry_path(self, value):
        if not value:
            return ""
        if value.startswith("//") or not value.startswith("/api/"):
            raise serializers.ValidationError("Only relative /api/ paths can be retried.")
        return value

    def validate_target_url(self, value):
        if value and (value.startswith("//") or not value.startswith("/")):
            raise serializers.ValidationError("Only in-app paths can be linked.")
        return value
