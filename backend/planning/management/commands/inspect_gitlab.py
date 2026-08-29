"""Print what GitLab actually returns for a project, without interpreting it.

For when the plan on screen disagrees with the plan in GitLab. Everything this
tool decides — which work items count, which milestone they belong to, who they
are assigned to — is decided from these payloads, so seeing them raw is the
difference between diagnosing the problem and guessing at it.

Deliberately dependency-free and read-only: it makes the same two calls
reconcile makes and writes nothing, so it is safe to run against production on
an air-gapped box where nothing else can be inspected.
"""

from collections import Counter

from django.core.management.base import BaseCommand, CommandError

from gitlab_api.exceptions import GitLabError
from gitlab_api.gateway import service_client
from projects.models import Project


class Command(BaseCommand):
    help = "Show the milestones and work items GitLab returns for a project."

    def add_arguments(self, parser):
        parser.add_argument("project", type=int, help="Project id in this database.")
        parser.add_argument(
            "--raw", action="store_true",
            help="Dump the first work item payload in full, field by field.",
        )

    def handle(self, *args, **options):
        project = Project.objects.select_related("repo").filter(pk=options["project"]).first()
        if project is None:
            raise CommandError(f"No project with id {options['project']}.")
        repo = getattr(project, "repo", None)
        if repo is None:
            raise CommandError(f"{project.name} has no repository linked.")

        self.stdout.write(f"{project.name}  →  {repo.path_with_namespace} "
                          f"(GitLab project {repo.gitlab_project_id})")

        try:
            client = service_client()
        except GitLabError as exc:
            raise CommandError(str(exc)) from exc

        # ---- milestones ---------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING("\nMilestones"))
        try:
            milestones = client.list_milestones(repo.gitlab_project_id)
        except GitLabError as exc:
            raise CommandError(f"Could not read milestones: {exc}") from exc

        if not milestones:
            self.stdout.write("  none returned")
        known: set[int] = set()
        for m in milestones:
            known.add(m.get("id"))
            scope = "group" if m.get("group_id") else "project"
            self.stdout.write(
                f"  id={m.get('id'):<8} iid={str(m.get('iid')):<5} {scope:<8} "
                f"{m.get('state', ''):<8} {m.get('title', '')}"
            )

        # ---- work items ---------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING("\nWork items"))
        try:
            items = client.list_tasks(repo.gitlab_project_id)
        except GitLabError as exc:
            raise CommandError(f"Could not read work items: {exc}") from exc

        if not items:
            self.stdout.write(
                "  none returned — GitLab reports no issues or tasks on this project at all"
            )

        types = Counter(i.get("issue_type") or "(no issue_type field)" for i in items)
        no_milestone = 0
        unknown_milestone = Counter()
        matched = 0

        for item in items:
            milestone = item.get("milestone") or {}
            if not milestone:
                no_milestone += 1
            elif milestone.get("id") in known:
                matched += 1
            else:
                unknown_milestone[
                    f"{milestone.get('title', '?')} (id {milestone.get('id')})"
                ] += 1

        for item in items[:40]:
            milestone = item.get("milestone") or {}
            assignee = item.get("assignee") or {}
            where = milestone.get("title") or self.style.WARNING("— no milestone —")
            self.stdout.write(
                f"  #{str(item.get('iid')):<6} {str(item.get('issue_type') or '?'):<10} "
                f"{item.get('state', ''):<7} "
                f"{(assignee.get('username') or '—'):<14} {where:<28} "
                f"{item.get('title', '')[:44]}"
            )
        if len(items) > 40:
            self.stdout.write(f"  … and {len(items) - 40} more")

        # ---- the verdict --------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING("\nWhat this tool would keep"))
        self.stdout.write(f"  read from GitLab      {len(items)}")
        self.stdout.write(f"  types                 "
                          f"{', '.join(f'{k}={v}' for k, v in types.items()) or '—'}")
        self.stdout.write(self.style.SUCCESS(f"  kept                  {matched}"))
        if no_milestone:
            self.stdout.write(self.style.WARNING(
                f"  dropped, no milestone {no_milestone}"
            ))
        if unknown_milestone:
            total = sum(unknown_milestone.values())
            self.stdout.write(self.style.WARNING(
                f"  dropped, milestone not visible to this project: {total}"
            ))
            for name, count in unknown_milestone.most_common(10):
                self.stdout.write(f"      {count:>4}  {name}")
            self.stdout.write(
                "      → these are usually group milestones. If they are missing from the\n"
                "        Milestones list above, this GitLab did not return ancestors."
            )

        if options["raw"] and items:
            self.stdout.write(self.style.MIGRATE_HEADING("\nFirst work item, in full"))
            for key in sorted(items[0]):
                self.stdout.write(f"  {key}: {items[0][key]!r}"[:200])
