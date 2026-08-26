from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import Team, TeamInvite, TeamMembership

User = get_user_model()


class TeamMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = TeamMembership
        fields = ["id", "user", "joined_on", "left_on", "is_active"]


class TeamSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    members = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Team
        fields = ["id", "name", "description", "owner", "members", "member_count", "created_at"]

    def get_members(self, team):
        active = team.memberships.filter(left_on__isnull=True).select_related("user")
        return TeamMembershipSerializer(active, many=True).data


class TeamWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ["name", "description"]


class AddMemberSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()

    def validate_user_id(self, value):
        user = User.objects.filter(pk=value).first()
        if user is None:
            raise serializers.ValidationError("No such person.")
        if not user.is_onboarded:
            raise serializers.ValidationError(
                "That person has not finished setting up their profile yet."
            )
        return value


class TeamInviteSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    state = serializers.CharField(read_only=True)
    is_usable = serializers.BooleanField(read_only=True)
    created_by_name = serializers.CharField(source="created_by.display_name", read_only=True)

    class Meta:
        model = TeamInvite
        fields = ["id", "token", "url", "note", "state", "is_usable", "uses",
                  "max_uses", "expires_at", "created_by_name", "created_at"]

    def get_url(self, invite):
        from django.conf import settings

        return f"{settings.FRONTEND_URL}/join/{invite.token}"


class CreateInviteSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    # Null means no limit: a link pasted into a team channel wants that, a link
    # sent to one person wants exactly one use.
    max_uses = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    expires_in_days = serializers.IntegerField(required=False, allow_null=True,
                                               min_value=1, max_value=90)
