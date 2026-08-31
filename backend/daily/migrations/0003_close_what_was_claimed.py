"""Keep every line somebody had already ticked.

Half of collapsing the two-stage tick back to one. This half only moves data;
``0004`` drops the columns. They are deliberately two migrations and not one.

Postgres will not ``ALTER TABLE`` a table that has *pending trigger events*, and
the update below creates them: ``closed_by`` is a foreign key, and Django
declares its constraints ``DEFERRABLE INITIALLY DEFERRED``, so the check is
queued until the transaction commits rather than run per row. A single migration
doing both would run inside one transaction and fail on the first
``RemoveField`` with

    cannot ALTER TABLE "daily_todo" because it has pending trigger events

and — this is the part that made it slip through — only on a database that has
rows to update. On an empty one the statement touches nothing, queues no
triggers, and passes.

Each migration gets its own transaction, so the update here is committed, and
its triggers fired, before ``0004`` starts altering anything.
"""

from django.db import migrations, models


def close_what_was_claimed(apps, schema_editor):
    """A line somebody ticked stays ticked.

    Anything claimed but never closed would come out of ``0004`` as plain open,
    which is wrong: the person did tick it. It is closed here instead, credited
    to whoever claimed it and stamped with when they said so.
    """
    Todo = apps.get_model("daily", "Todo")
    Todo.objects.filter(done_at__isnull=True, claimed_at__isnull=False).update(
        done_at=models.F("claimed_at"), closed_by=models.F("claimed_by")
    )


class Migration(migrations.Migration):

    dependencies = [
        ("daily", "0002_todo_claimed_at_todo_claimed_by_todo_closed_by"),
    ]

    operations = [
        migrations.RunPython(close_what_was_claimed, migrations.RunPython.noop),
    ]
