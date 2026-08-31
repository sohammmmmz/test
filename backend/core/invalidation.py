"""Cache invalidation, wired to the models rather than to the views.

The alternative — bumping a scope by hand in each view that writes — was tried
first and is a trap. Writes happen in services, in management commands, in the
GitLab reconcile, in the admin, and in cascade deletes, and every one of those
paths that gets forgotten is a screen that shows yesterday's numbers with no
error anywhere. A ``post_save`` fires for all of them.

The cost is that a bulk write — ``reconcile_project`` touching two hundred
tasks — bumps the same scope two hundred times. That is two hundred integer
increments against Redis, which is genuinely cheap, and the alternative is
remembering to suppress and re-bump around every bulk path. Where a bulk write
is hot enough to care, ``planning.services`` batches it explicitly.

``bulk_create``/``bulk_update``/``queryset.update()`` do **not** fire these
signals. Anything using them has to bump for itself; there is a note at each
such site.
"""

from __future__ import annotations

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .cache import SCOPES, bump, scoped


def _project_id_of(instance) -> int | None:
    """The project a row belongs to, without provoking a query.

    A ``Milestone`` carries ``project_id`` outright. A ``Task`` only knows its
    milestone, and reaching through would be one query per row — which during a
    reconcile of two hundred tasks is two hundred queries spent purely on
    deciding what to invalidate. So it is read from the relation cache, which is
    already populated wherever the task was saved with its milestone in hand,
    and skipped otherwise. Skipping is safe: the bare ``PLAN`` scope is bumped
    either way, and every per-project plan key is versioned against that too.
    """
    # `in instance.__dict__` rather than getattr: `Issue.project_id` is a
    # *property* that walks task → milestone → project, so asking for it here
    # would be two queries per row saved, which during a reconcile is hundreds.
    # A real concrete column is always in the instance dict.
    if "project_id" in instance.__dict__:
        return instance.__dict__["project_id"]
    cached = instance._state.fields_cache.get("milestone")
    return getattr(cached, "project_id", None)


def _register():
    from daily.models import Meeting, MeetingNote, Todo
    from planning.models import Issue, Milestone, Task
    from projects.models import Document, GitLabRepo, Project, ProjectMember
    from teams.models import Team, TeamInvite, TeamMembership

    @receiver([post_save, post_delete], sender=Project, dispatch_uid="inv-project")
    @receiver([post_save, post_delete], sender=GitLabRepo, dispatch_uid="inv-repo")
    @receiver([post_save, post_delete], sender=Document, dispatch_uid="inv-doc")
    def _projects_changed(sender, instance, **kwargs):
        bump(SCOPES.PROJECTS)

    @receiver([post_save, post_delete], sender=ProjectMember, dispatch_uid="inv-pmember")
    def _project_members_changed(sender, instance, **kwargs):
        # Membership moves both what a project shows and which projects a person
        # can see at all, so the people scope goes too.
        bump(SCOPES.PROJECTS, SCOPES.PEOPLE)

    @receiver([post_save, post_delete], sender=Milestone, dispatch_uid="inv-milestone")
    @receiver([post_save, post_delete], sender=Task, dispatch_uid="inv-task")
    @receiver([post_save, post_delete], sender=Issue, dispatch_uid="inv-issue")
    def _plan_changed(sender, instance, **kwargs):
        project_id = _project_id_of(instance)
        # The per-project scope is what keeps one project's sync from clearing
        # every other project's plan. The bare scope backs the aggregate views
        # that span projects and cannot be keyed to one.
        bump(SCOPES.PLAN, scoped(SCOPES.PLAN, project_id))

    @receiver([post_save, post_delete], sender=Todo, dispatch_uid="inv-todo")
    def _todos_changed(sender, instance, **kwargs):
        bump(SCOPES.TODOS, scoped(SCOPES.TODOS, instance.user_id))

    @receiver([post_save, post_delete], sender=Team, dispatch_uid="inv-team")
    @receiver([post_save, post_delete], sender=TeamInvite, dispatch_uid="inv-invite")
    def _teams_changed(sender, instance, **kwargs):
        bump(SCOPES.TEAMS)

    @receiver([post_save, post_delete], sender=Meeting, dispatch_uid="inv-meeting")
    @receiver([post_save, post_delete], sender=MeetingNote, dispatch_uid="inv-mnote")
    def _meeting_changed(sender, instance, **kwargs):
        bump(SCOPES.TODOS)

    @receiver([post_save, post_delete], sender=TeamMembership, dispatch_uid="inv-tmember")
    def _team_membership_changed(sender, instance, **kwargs):
        # A membership change moves the General roster, which is computed from
        # every other team, so no team's cached view survives it.
        bump(SCOPES.TEAMS, SCOPES.PEOPLE)


_register()
