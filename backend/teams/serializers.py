from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.serializers import UserSerializer

from .models import Team, TeamMembership

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
