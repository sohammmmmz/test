"""Collapse the two-stage tick back to one.

A member's tick used to only *claim* a line — "I have finished this" — and an
owner had to close it in the morning meeting. Two problems with it in practice:
ticking your own work felt like filing a request, and reopening a closed line
cleared ``done_at`` but left ``claimed_at`` behind, so it came back reading
"marked done by … · waiting to be closed" instead of open.

Dropping the columns loses who first said a line was finished. That is a real
loss and it is deliberate: ``closed_by`` records who ticked it, which is the
same person in every case that mattered.

``0003`` runs first and rescues anything mid-flight. It has to be a separate
migration; the note there explains why.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("daily", "0003_close_what_was_claimed"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="todo",
            name="claimed_at",
        ),
        migrations.RemoveField(
            model_name="todo",
            name="claimed_by",
        ),
    ]
