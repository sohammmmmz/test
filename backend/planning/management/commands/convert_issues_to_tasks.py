"""Convert work this tool created as plain issues into work items of type task.

A one-off, for projects planned before tasks and issues were told apart. Nothing
reads issues any more, so without this the milestones would look empty even
though the work is sitting in GitLab exactly where it was left.

Only rows this tool created are touched — every one is a Task in this database
with a GitLab iid, so an issue somebody opened by hand is never in scope. It is
safe to run twice: converting a task to a task changes nothing.
"""

from django.core.management.base import BaseCommand

from gitlab_api.exceptions import GitLabError
from gitlab_api.gateway import service_client
from planning.models import Task
from projects.models import Project


class Command(BaseCommand):
    help = "Convert issues this tool created into GitLab task work items."

    def add_arguments(self, parser):
        parser.add_argument(
            "--project", type=int, default=None,
            help="Only this project id. Default: every project with a repository.",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Say what would change and change nothing.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        projects = Project.objects.select_related("repo")
        if options["project"]:
            projects = projects.filter(pk=options["project"])

        client = None if dry_run else service_client()
        converted = failed = skipped = 0

        for project in projects:
            repo = getattr(project, "repo", None)
            if repo is None:
                continue

            tasks = (
                Task.objects.filter(milestone__project=project, gitlab_iid__isnull=False)
                .order_by("gitlab_iid")
            )
            if not tasks.exists():
                continue

            self.stdout.write(f"\n{project.name}  ({repo.path_with_namespace})")
            for task in tasks:
                label = f"  #{task.gitlab_iid} {task.title[:56]}"
                if dry_run:
                    self.stdout.write(f"{label}  → would convert")
                    skipped += 1
                    continue
                try:
                    client.convert_to_task(repo.gitlab_project_id, task.gitlab_iid)
                except GitLabError as exc:
                    self.stderr.write(self.style.WARNING(f"{label}  → failed: {exc}"))
                    failed += 1
                    continue
                self.stdout.write(self.style.SUCCESS(f"{label}  → task"))
                converted += 1

        self.stdout.write("")
        if dry_run:
            self.stdout.write(f"{skipped} would be converted. Run again without --dry-run.")
        else:
            self.stdout.write(self.style.SUCCESS(f"{converted} converted, {failed} failed."))
