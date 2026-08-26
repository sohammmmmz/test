# Morning Ledger

A project management layer over GitLab, built around the thing that actually
decides an engineering team's day: the morning standup.

A **project** is a GitLab repository. A **task** is a GitLab issue. Milestones,
tasks and assignments are created here and written straight to GitLab, so the
team's own boards and this tool cannot drift apart. What GitLab has no place for
— each person's todo list for today, what carried over from yesterday, and the
record of the meeting where it was decided — lives here.

---

## Running it

Three processes: Postgres, Django, Next.js.

```bash
# 1. Database
docker run -d --name pms-postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=pms \
  -p 5432:5432 postgres:16-alpine

# 2. Backend
python3 -m venv .venv
.venv/bin/pip install django djangorestframework django-cors-headers \
  "psycopg[binary]" django-environ PyJWT requests
cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py seed_demo      # optional sample data
../.venv/bin/python manage.py runserver 8000

# 3. Frontend
cd frontend && npm install && npm run dev
```

Then open http://localhost:3000.

### Demo mode

`DEMO_MODE=true` in `.env` (the default here) lets the whole product be driven
without a GitLab application: repositories, milestones and issues are simulated
locally and a second sign-in door appears. Nothing reaches a real repository.
Turn it off before pointing this at anything real.

---

## Connecting real GitLab

Four values in `.env`:

| Variable | What it is |
|---|---|
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | An OAuth application with the **`api`** and **`read_user`** scopes, from GitLab → Settings → Applications. `read_api` is not enough — it cannot create milestones, issues, branches or memberships. |
| `GITLAB_SERVICE_TOKEN` | A **group access token** with the `api` scope. Performs every write. |
| `GITLAB_GROUP_ID` | The group new repositories are created under. |

Then set `DEMO_MODE=false` and restart Django.

**Why two credentials.** OAuth access tokens live two hours and refreshing
rotates the refresh token, so nothing shared can depend on one person staying
signed in — or employed. A user's OAuth token proves who they are; the service
token owns every write.

---

## How it works

### Signing in

Everyone signs in through GitLab, because assigning an issue needs a real
`gitlab_user_id` — somebody who exists only in this database can never be given
work. GitLab cannot tell us which of the two roles a person holds or which
department they are in, so a first sign-in lands on a short onboarding step.

- **Project owners** create projects, build teams and run the morning meeting.
- **Project members** hold tasks and todos, and see only their own day.

Both end at the same JWT pair in httpOnly cookies. The access token is short
(30 minutes) and carries the identity; the refresh token is long (30 days) and
its only power is to mint a new pair. It is rotated on every use, and presenting
an already-rotated one revokes the whole session — that is evidence it was
copied, not a request to be politely refused.

Refreshing happens in Next.js middleware, the only place that can rewrite the
cookies the current render reads *and* set them on the response.

### Creating a project

Six steps, in an order where each needs the last:

1. Create the repository **initialised** — a GitLab project with no commits has
   no branches, and there would be nothing to cut a member branch from.
2. Add the chosen people to the repository as Developers.
3. Cut a standing branch per member, named from their GitLab handle.
4. Create the `documentation` branch, in the same commit that writes its README
   so no empty branch survives a failure.
5. Upload the BRD and technical document — committed to git, not stored in a
   column.
6. Plan milestones and tasks, written to GitLab as they are created.

Failures after step 1 are reported rather than raised: a project whose third
branch failed is a real project with one thing to fix.

### Milestones and tasks

Two levels. A milestone holds tasks directly, and each task is one GitLab issue
with one assignee — multiple assignees is a Premium feature, and GitLab's child
work items do not inherit their parent's milestone, so a third level would mean
maintaining in Postgres what GitLab would not maintain for us.

Writes go upstream first and are mirrored locally only once GitLab accepts them,
so the board can never show a task that is not a real issue. Opening a project
reconciles the other way, so an issue closed in GitLab's own UI is reflected
here rather than silently overwritten — **and its todo is ticked off**, because
they are the same piece of work.

### The day

A todo is not a task. A task is an issue that may take a week; a todo is one
line on one person's list for one day, and it may point at a task or exist
entirely on its own.

Each day gets its own rows rather than one row whose date moves, so the owner
can look back at what somebody's list actually said on Tuesday. Unfinished work
is copied forward and the copy remembers where it came from, which is what the
**carry-thread** draws: one strand per working day a line has survived, so age
reads at a glance without anyone counting.

There is no scheduled job. A cron that builds tomorrow's lists is a cron that
can silently not run, and the failure looks like everyone having an empty
morning. The day is materialised the first time anyone asks for it.

Weekends and configured non-working days are skipped, so Monday carries Friday's
unfinished work rather than three days of it (`WORKING_WEEKDAYS`).

### The morning meeting

Opens on the board — the whole team side by side, so the owner walks in already
knowing where the trouble is. **Pending** is yesterday's incomplete work plus
anything overdue; **suggested** is their open GitLab tasks, soonest due first.

Starting the meeting turns the board into a round: one person at a time, with
the rest receding but still visible so it is always clear how much is left. The
owner confirms, reassigns, adds work that has nothing to do with GitLab, and
records blockers. Publishing writes everyone's day at once and saves the meeting.

The owner takes a turn too — they carry todos like anyone else, and running the
team is the easiest way to lose sight of your own work. They go last, and their
own outstanding items also surface as alerts on the dashboard.

---

## Layout

```
backend/
  accounts/    users, roles, GitLab OAuth, JWT rotation
  gitlab_api/  REST client, OAuth flow, demo stand-in
  teams/       an owner's standing roster
  projects/    projects, repositories, branches, documents, readiness
  planning/    milestones and tasks, two-way with GitLab
  daily/       todos, carry-forward, the morning meeting
frontend/src/
  middleware.ts  silent token refresh, CSRF top-up, signed-out redirects
  app/(app)/     today, projects, team, morning meeting, my day
  components/    the round, the plan, todo lists, the carry-thread
  lib/           server-side Django client, deterministic formatting
```

## Design

The palette is built on the blue hour — the light just before sunrise — because
this is a tool you open at the start of the day. The brand colour is cool so the
entire warm end of the spectrum is free to mean something: jade for done, amber
for attention, rose for overdue. The ambient wash follows the clock; nothing
else does, because an interface whose warning colour drifts is one nobody
trusts.

Bricolage Grotesque for display, Public Sans for body, JetBrains Mono for dates,
counts and branch names.

## Notes

- `TODO_STALE_AFTER_DAYS` (default 3) is when a carried line starts showing its
  age.
- A member can be on more than one owner's team; the meeting is scoped to a
  team, not to an owner.
- Deleting a project leaves the GitLab repository alone unless explicitly asked
  — this tool tracks repositories, it does not own them.
