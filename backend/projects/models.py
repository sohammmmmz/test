"""Projects, and the GitLab repositories they are.

A project *is* a repository — there is no such thing here as a project without
one. Creating a project creates the repo, its member branches and its
documentation branch; deleting a project leaves the repository alone, because
this tool tracks repositories, it does not own them.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone


class ProjectStatus(models.TextChoices):
    PLANNING = "planning", "Planning"
    ACTIVE = "active", "Active"
    ON_HOLD = "on_hold", "On hold"
    COMPLETED = "completed", "Completed"
    ARCHIVED = "archived", "Archived"


class Project(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    status = models.CharField(
        max_length=16, choices=ProjectStatus.choices, default=ProjectStatus.PLANNING
    )

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_projects"
    )
    team = models.ForeignKey(
        "teams.Team", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="projects",
    )

    started_on = models.DateField(null=True, blank=True)
    target_end_on = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    # -- progress ----------------------------------------------------------

    def progress(self) -> dict:
        """Completion read against schedule.

        Two numbers, because either alone misleads: a project can be most of
        the way done and still late, and a project can be barely started and
        perfectly on time.
        """
        from planning.models import Milestone, Task

        tasks = Task.objects.filter(milestone__project=self)
        total = tasks.count()
        done = tasks.filter(state=Task.State.CLOSED).count()

        today = timezone.localdate()
        milestones = Milestone.objects.filter(project=self)
        overdue = [
            m for m in milestones
            if m.due_date and m.due_date < today and m.state == Milestone.State.ACTIVE
        ]
        next_due = (
            milestones.filter(state=Milestone.State.ACTIVE, due_date__gte=today)
            .order_by("due_date")
            .first()
        )

        return {
            "total_tasks": total,
            "completed_tasks": done,
            "percent": round(done / total * 100) if total else 0,
            "overdue_milestones": len(overdue),
            "is_slipping": bool(overdue),
            "next_due_date": next_due.due_date if next_due else None,
            "next_milestone": next_due.title if next_due else None,
        }

    # -- readiness ---------------------------------------------------------

    def readiness(self) -> dict:
        """The four things a project needs before it is properly set up.

        Fixed rather than configurable: four checks do not justify a rules
        engine, and each one names its own remedy so a failure is actionable
        rather than merely red.
        """
        from planning.models import Milestone

        has_dated_milestone = Milestone.objects.filter(
            project=self, due_date__isnull=False
        ).exists()
        kinds = set(self.documents.values_list("kind", flat=True))
        has_members = self.members.exists()

        checks = [
            {
                "key": "milestones",
                "label": "Milestones with dates",
                "passed": has_dated_milestone,
                "remedy": "Add a milestone with a due date so there is a timeline to track.",
            },
            {
                "key": "brd",
                "label": "Business requirements document",
                "passed": DocumentKind.BRD in kinds,
                "remedy": "Upload the BRD — it is committed to the documentation branch.",
            },
            {
                "key": "technical",
                "label": "Technical document",
                "passed": DocumentKind.TECHNICAL in kinds,
                "remedy": "Upload the technical document.",
            },
            {
                "key": "members",
                "label": "Members assigned",
                "passed": has_members,
                "remedy": "Add at least one person from your team to this project.",
            },
        ]
        passed = sum(1 for c in checks if c["passed"])
        return {
            "checks": checks,
            "passed": passed,
            "total": len(checks),
            "is_ready": passed == len(checks),
        }


class GitLabRepo(models.Model):
    """The repository backing a project. Mandatory, and one to one."""

    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name="repo")

    gitlab_project_id = models.BigIntegerField(unique=True, db_index=True)
    path_with_namespace = models.CharField(max_length=512)
    name = models.CharField(max_length=255)
    web_url = models.URLField(blank=True)
    http_url_to_repo = models.CharField(max_length=512, blank=True)
    ssh_url_to_repo = models.CharField(max_length=512, blank=True)
    default_branch = models.CharField(max_length=255, default="main")
    visibility = models.CharField(max_length=32, default="private")
    namespace_path = models.CharField(max_length=512, blank=True)

    # Which branch this project's documents live on. Per project rather than a
    # single global setting, because a repository being linked rather than
    # created may already keep its docs somewhere established, and moving them
    # to satisfy this tool would be the wrong way round.
    documentation_branch = models.CharField(max_length=255, blank=True)
    documentation_branch_ready = models.BooleanField(default=False)

    # True when this app created the repository, rather than linking one that
    # already existed. Deleting is only ever offered for the former.
    created_by_app = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "GitLab repository"
        verbose_name_plural = "GitLab repositories"

    def __str__(self):
        return self.path_with_namespace

    @property
    def docs_branch(self) -> str:
        """The branch documents are committed to, falling back to the default."""
        from django.conf import settings

        return self.documentation_branch or settings.DOCUMENTATION_BRANCH


class ProjectMember(models.Model):
    """Somebody working on a project, and the branch cut for them."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_memberships"
    )
    branch_name = models.CharField(max_length=512, blank=True)
    access_level = models.PositiveSmallIntegerField(default=30)
    # False when GitLab refused the membership or the branch — the person is
    # still on the project here, and the screen says what did not happen.
    synced_to_gitlab = models.BooleanField(default=False)
    sync_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["user__first_name", "user__username"]
        constraints = [
            models.UniqueConstraint(fields=["project", "user"], name="uniq_project_member")
        ]

    def __str__(self):
        return f"{self.user} on {self.project}"


class DocumentKind(models.TextChoices):
    BRD = "brd", "Business requirements document"
    TECHNICAL = "technical", "Technical document"


class Document(models.Model):
    """A BRD or technical document, committed to the documentation branch.

    The file lives in git, not in a blob column here: versioned with the
    project, readable by anyone who clones it, and verifiable as a real file
    rather than a row claiming one exists.
    """

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="documents")
    kind = models.CharField(max_length=32, choices=DocumentKind.choices)
    filename = models.CharField(max_length=255)
    repo_path = models.CharField(max_length=512)
    content_type = models.CharField(max_length=128, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_hash = models.CharField(max_length=64, blank=True)
    commit_sha = models.CharField(max_length=64, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="uploaded_documents",
    )
    uploaded_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["project", "kind"]
        constraints = [
            models.UniqueConstraint(fields=["project", "kind"], name="uniq_document_per_kind")
        ]

    def __str__(self):
        return f"{self.get_kind_display()} for {self.project.name}"
