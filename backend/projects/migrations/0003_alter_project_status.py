"""Move projects from the old five states onto the delivery lifecycle.

The column has to be rewritten as well as redefined: a project sitting on
"active" would otherwise keep a value that is no longer one of the choices —
legal in Postgres, invisible in a dropdown, and reported by every screen as a
status nobody can select or leave.

`on_hold` is the one with no successor. The new list is a lifecycle and has no
paused state, so a held project lands back on Draft, which is the only phase
that does not assert work is happening. Anything held at the time of this
migration is worth re-checking by hand.
"""

from django.db import migrations, models

FORWARD = {
    "planning": "draft",
    "active": "development",
    "on_hold": "draft",
    "completed": "closed",
    "archived": "closed",
}

# Not a true inverse — closed cannot tell completed from archived, and draft
# cannot tell planning from on_hold. It exists so the migration can be unapplied
# without leaving unreadable values behind.
BACKWARD = {
    "draft": "planning",
    "requirements": "planning",
    "development": "active",
    "testing": "active",
    "deployment": "active",
    "uat": "active",
    "production": "active",
    "maintenance": "active",
    "closed": "completed",
}


NEW_STATUSES = {
    "draft", "requirements", "development", "testing",
    "deployment", "uat", "production", "maintenance", "closed",
}
OLD_STATUSES = {"planning", "active", "on_hold", "completed", "archived"}


def _remap(apps, table: dict, valid: set[str], default: str):
    Project = apps.get_model("projects", "Project")
    for source, target in table.items():
        Project.objects.filter(status=source).update(status=target)
    # Anything unrecognised — hand-edited, or from a version not in this history
    # — is parked rather than left on a value no dropdown can offer. Checked
    # against every legal status, not just the ones this table produces, so a
    # project already sitting on a new value is left alone.
    Project.objects.exclude(status__in=valid).update(status=default)


def forwards(apps, schema_editor):
    _remap(apps, FORWARD, NEW_STATUSES, "draft")


def backwards(apps, schema_editor):
    _remap(apps, BACKWARD, OLD_STATUSES, "planning")


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0002_gitlabrepo_created_by_app_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="project",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("requirements", "Requirement Gathering"),
                    ("development", "Development Phase"),
                    ("testing", "Testing Phase"),
                    ("deployment", "Deployment Phase"),
                    ("uat", "UAT Phase"),
                    ("production", "Production Phase"),
                    ("maintenance", "Maintenance Phase"),
                    ("closed", "Closed"),
                ],
                default="draft",
                max_length=24,
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
