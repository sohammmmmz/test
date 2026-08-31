"""An issue always says what it was raised against.

Separate from ``0005`` on purpose: that one updates rows, and Postgres refuses
to ``ALTER TABLE`` a table with pending trigger events, so a constraint added in
the same transaction is a hazard waiting for a database with data in it.

The invariant is deliberately about the *text*, not the links. ``todo`` is
SET_NULL so that clearing a line off your day never deletes a bug report filed
against it — which means an issue raised on a bare todo ends up with neither a
task nor a todo, and a constraint requiring one of those would make deleting
such a todo fail outright. What survives, and what has to be true, is that the
issue still says what it was about.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("planning", "0005_issue_on_todo"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="issue",
            constraint=models.CheckConstraint(
                condition=models.Q(("raised_against", ""), _negated=True),
                name="issue_says_what_it_is_about",
            ),
        ),
    ]
