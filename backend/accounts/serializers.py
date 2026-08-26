from rest_framework import serializers

from .models import Department, Role, User


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    is_onboarded = serializers.BooleanField(read_only=True)
    is_owner = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "display_name", "first_name", "last_name",
            "gitlab_user_id", "gitlab_username", "gitlab_avatar_url",
            "role", "department", "job_title", "is_onboarded", "is_owner",
        ]
        read_only_fields = fields


class OnboardingSerializer(serializers.Serializer):
    """The two things GitLab cannot tell us about a person."""

    role = serializers.ChoiceField(choices=Role.choices)
    department = serializers.ChoiceField(choices=Department.choices)
    job_title = serializers.CharField(required=False, allow_blank=True, max_length=255)
