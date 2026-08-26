"""Sample data, so the product can be walked through immediately.

Runs entirely against the demo GitLab stand-in, so it needs no credentials and
touches no real repository. Idempotent-ish: ``--wipe`` clears what it made
before rebuilding, which is what you want between demos.
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import Department, Role, User
from daily.models import Todo, TodoSource
from daily.services import ensure_day
from planning.services import create_milestone, create_task
from projects.models import Project
from projects.services import create_project
from teams.models import Team, TeamMembership

PEOPLE = [
    ("Riya Sharma", Role.OWNER, Department.ENGINEERING, "Engineering manager"),
    ("Daniel Okafor", Role.MEMBER, Department.ENGINEERING, "Senior engineer"),
    ("Mei Tanaka", Role.MEMBER, Department.ENGINEERING, "Backend engineer"),
    ("Arjun Patel", Role.MEMBER, Department.QA, "QA engineer"),
    ("Lena Fischer", Role.MEMBER, Department.DESIGN, "Product designer"),
    ("Tom Reyes", Role.MEMBER, Department.ENGINEERING, "Frontend engineer"),
]

PROJECTS = [
    (
        "Apollo Checkout",
        "Rebuild of the payment flow, targeting a 40% drop in cart abandonment.",
        [
            ("M1 — Payment rails", 14, [
                ("Wire up the Stripe intent endpoint", 0, 2),
                ("Idempotency keys on retry", 1, 5),
                ("Handle 3DS challenge redirects", 2, 9),
            ]),
            ("M2 — Checkout UI", 32, [
                ("Single-page address form", 4, 20),
                ("Saved cards list", 5, 24),
                ("Error states for declined cards", 3, 28),
            ]),
        ],
    ),
    (
        "Beacon Analytics",
        "Self-serve dashboards for account managers, replacing the weekly CSV.",
        [
            ("M1 — Query layer", -3, [
                ("Aggregation service skeleton", 2, -6),
                ("Cache warm on login", 1, -1),
            ]),
            ("M2 — Dashboard shell", 21, [
                ("Chart component library", 5, 12),
                ("Saved views per account", 4, 18),
            ]),
        ],
    ),
    (
        "Harbor Migration",
        "Move the legacy scheduler off the monolith before the datacentre exit.",
        [
            ("M1 — Extract the scheduler", 45, [
                ("Shadow-write job queue", 2, 30),
                ("Backfill historical runs", 1, 38),
            ]),
        ],
    ),
]


class Command(BaseCommand):
    help = "Create a demo team, projects, milestones, tasks and todos."

    def add_arguments(self, parser):
        parser.add_argument("--wipe", action="store_true",
                            help="Delete existing demo data first.")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEMO_MODE:
            raise CommandError(
                "Seeding needs DEMO_MODE=true, so nothing here can reach a real "
                "repository. Set it in .env and try again."
            )

        if options["wipe"]:
            Project.objects.all().delete()
            Team.objects.all().delete()
            Todo.objects.all().delete()
            User.objects.filter(is_superuser=False).delete()
            self.stdout.write("Cleared previous demo data.")

        users = []
        for index, (name, role, department, title) in enumerate(PEOPLE):
            handle = name.lower().replace(" ", "-")
            user, _ = User.objects.get_or_create(
                username=handle,
                defaults={
                    "email": f"{handle}@demo.local",
                    "first_name": name.split(" ")[0],
                    "last_name": name.split(" ")[1],
                    "gitlab_user_id": 9100 + index,
                    "gitlab_username": handle,
                },
            )
            user.complete_onboarding(role=role, department=department, job_title=title)
            users.append(user)

        owner, members = users[0], users[1:]

        team, _ = Team.objects.get_or_create(
            owner=owner, name="Platform",
            defaults={"description": "The team behind checkout, analytics and the migration."},
        )
        for member in members:
            TeamMembership.objects.get_or_create(team=team, user=member, left_on=None)

        today = timezone.localdate()
        created_tasks = []

        for project_index, (name, description, milestones) in enumerate(PROJECTS):
            if Project.objects.filter(name=name).exists():
                continue
            # Spread the roster so no project has everybody on it.
            staff = members[project_index:] + members[:project_index]
            project, _warnings = create_project(
                name=name, owner=owner, description=description, team=team,
                member_users=staff[:4], status="active",
                started_on=today - timedelta(days=40),
                target_end_on=today + timedelta(days=60),
            )

            for title, due_offset, tasks in milestones:
                milestone = create_milestone(
                    project,
                    title=title,
                    description="",
                    start_date=today - timedelta(days=10),
                    due_date=today + timedelta(days=due_offset),
                )
                for task_title, assignee_index, task_offset in tasks:
                    task = create_task(
                        milestone,
                        title=task_title,
                        assignee=users[assignee_index % len(users)],
                        due_date=today + timedelta(days=task_offset),
                    )
                    created_tasks.append(task)

        # Two working weeks of history. Long enough that a few lines have been
        # carried past the stale threshold, which is the state the carry-thread
        # exists to make visible — a demo where nothing is old shows nothing.
        working = {int(d) for d in settings.WORKING_WEEKDAYS}
        past_days = [
            today - timedelta(days=offset)
            for offset in range(14, 0, -1)
            if (today - timedelta(days=offset)).weekday() in working
        ]

        # Seeded on the earliest day only, so it genuinely rolls forward rather
        # than being re-added each morning.
        LONG_RUNNERS = {
            1: "Chase the staging DB restore with infra",
            2: "Write up the retry semantics for review",
            4: "Redo the empty states for the dashboard",
        }
        DAILY = [
            "Review the migration runbook",
            "Pair on the failing integration test",
            "Triage the overnight CI failures",
            "Update the release notes",
        ]

        for day_index, day in enumerate(past_days):
            for index, person in enumerate(users):
                carried = ensure_day(person, day)

                # Most carried work does get finished. Without this every
                # unfinished line would roll for the full fortnight and
                # "carrying for days" would describe the whole team, which
                # would make the signal worth nothing.
                for position, todo in enumerate(carried):
                    keeps_rolling = todo.title in LONG_RUNNERS.values()
                    if keeps_rolling or (position + day_index) % 4 == 0:
                        continue
                    todo.done_at = timezone.now()
                    todo.save(update_fields=["done_at"])

                if day_index == 0 and index in LONG_RUNNERS:
                    Todo.objects.create(
                        user=person, date=day, title=LONG_RUNNERS[index],
                        source=TodoSource.MANUAL, first_added_on=day,
                        created_by=owner,
                    )

                if Todo.objects.filter(
                    user=person, date=day, source=TodoSource.MANUAL,
                    title__in=DAILY,
                ).exists():
                    continue

                # Most of these get finished; some do not, so the carry-forward
                # has something real to move.
                finished = (day_index + index) % 3 != 0
                Todo.objects.create(
                    user=person, date=day,
                    title=DAILY[(day_index + index) % len(DAILY)],
                    source=TodoSource.MANUAL, first_added_on=day, created_by=owner,
                    done_at=timezone.now() if finished else None,
                )

        for person in users:
            ensure_day(person, today)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(users)} people, 1 team, {Project.objects.count()} projects, "
            f"{len(created_tasks)} tasks."
        ))
        self.stdout.write(f"Sign in as the owner: {owner.display_name} ({owner.gitlab_username})")
