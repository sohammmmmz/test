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
../.venv/bin/python manage.py runserver 8000

# 3. Frontend
cd frontend && npm install && npm run dev
```

Then open http://localhost:3000.

## Connecting real GitLab

Four values in `.env`:

| Variable | What it is |
|---|---|
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | An OAuth application with the **`api`** and **`read_user`** scopes, from GitLab → Settings → Applications. `read_api` is not enough — it cannot create milestones, issues, branches or memberships. |
| `GITLAB_SERVICE_TOKEN` | A **group access token** with the `api` scope. Performs every write. |
| `GITLAB_GROUP_ID` | The group new repositories are created under. |

Restart Django once they are in place.

**Why two credentials.** OAuth access tokens live two hours and refreshing
rotates the refresh token, so nothing shared can depend on one person staying
signed in — or employed. A user's OAuth token proves who they are; the service
token owns every write.

---

## How it works

### Signing in

Everyone signs in through GitLab — there is deliberately no second door,
because assigning an issue needs a real `gitlab_user_id` and somebody who
exists only in this database could never be given work. The handshake runs in
a popup, so a failed authorization returns to the sign-in screen rather than a
cold start. GitLab cannot tell us which of the two roles a person holds or which
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

Either link a repository you already have, or let one be created. Linking is
the common case once a team exists, and the picker only offers repositories the
service token can write to — so anything listed is guaranteed to work once
linked. A repository already backing another project is shown but not
selectable, because a repository backs exactly one project; sharing one would
make every milestone ambiguous.

The **documentation branch** is chosen per project rather than fixed globally.
A repository being linked may already keep its docs somewhere established, and
moving them to suit this tool would be the wrong way round — so pick that
branch, or have a new one made.

Six steps, in an order where each needs the last:

1. Create the repository **initialised**, or link the one you picked. A GitLab
   project with no commits has no branches, and there would be nothing to cut a
   member branch from.
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

### Inviting people

An owner cannot add somebody who has never signed in, and they will not sign in
unless asked. An invite link breaks that circle: it carries the team through
the GitLab handshake, so signing up and joining happen in one act. The person
lands on the sign-in screen told which team they are joining, and comes out the
other side a member of it.

Links can be single-use or reusable, expire after 14 days, and can be turned
off at any moment. The token is the credential, so it is the only thing that
identifies an invite — treat a link like a password.

An invite settles the role, so the profile step afterwards only asks for a
department.

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

#### Ticking is not closing

A todo has three states, not two. A member ticking a line off is a **claim** —
"I have finished this" — recorded with who said it and when. It shows amber, and
it is not closed. Closing is the owner's, and it happens in the morning meeting.

Collapsing the two into one flag would lose exactly what the owner asked to be
able to see: what was said to be finished, and whether anybody checked. A claimed
line still carries forward if the round has not reached it, but it does not age
and it is never marked stale — it is waiting on the review, not on the person
holding it, and colouring it as their backlog would blame the wrong end.

The one closing nobody performs: a task closed in GitLab closes the todo that
pointed at it, because the evidence is already there.

### The morning meeting

Opens on the board — the whole team side by side, so the owner walks in already
knowing where the trouble is. The board is read-only: ticking things off before
the round has started is how a standup becomes a form somebody fills in
beforehand.

Starting it takes over the screen. The round is the one thing here that is
*performed*, with a room waiting on it, so nothing else stays on screen to
compete with the person whose turn it is:

- **Left** — every name on the team, popping up in order, each showing how much
  is open and how much is waiting to be closed. Any name can be jumped to.
- **Centre** — whose turn it is. Work they marked done and nobody has confirmed
  comes first, because it is the only thing on the screen that cannot be settled
  anywhere else. Then what is still open, then what closed today, then GitLab
  tasks they could pick up.
- **Right** — last meeting's pointers: what was agreed, what was blocking them,
  how much of that list actually closed. Hideable, and the first thing to go on
  a narrow screen.

Arrow keys move the round and Escape minimises it, because the owner is talking,
not aiming a mouse. Publishing writes everyone's day at once and saves the
meeting.

The owner takes a turn too — they carry todos like anyone else, and running the
team is the easiest way to lose sight of your own work. They go last, and their
own outstanding items also surface as alerts on the dashboard.

---

## Layout

```
backend/
  accounts/    users, roles, GitLab OAuth, JWT rotation
  gitlab_api/  REST client and OAuth flow
  teams/       an owner's standing roster
  projects/    projects, repositories, branches, documents, readiness
  planning/    milestones and tasks, two-way with GitLab
  daily/       todos, carry-forward, the morning meeting
frontend/src/
  middleware.ts  silent token refresh, CSRF top-up, signed-out redirects
  app/join/      the other end of an invite link
  app/auth/      where GitLab's round trip lands
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

Every route has a skeleton shaped like the page that is coming, rather than a
spinner in an empty frame — a page that already looks like itself reads as
faster, and nothing jumps when the data lands.

## Notes on the GitLab sign-in

The handshake runs in a popup. Two things about that are not obvious:

- GitLab serves `Cross-Origin-Opener-Policy: same-origin`, which permanently
  severs the opener link. `window.opener` is null on the way back and
  `popup.closed` starts reporting true for a window that is plainly still open.
  So the popup announces its result over `BroadcastChannel`, and the sign-in
  screen also polls its own session as a backstop.
- Django's CSRF cookie is minted on GET endpoints that the *server* calls
  during rendering, so its `Set-Cookie` never reaches the browser. The
  middleware tops it up once per session; without that every client-side write
  fails with "CSRF cookie not set".

## Notes

- `TODO_STALE_AFTER_DAYS` (default 3) is when a carried line starts showing its
  age.
- A member can be on more than one owner's team; the meeting is scoped to a
  team, not to an owner.
- Deleting a project leaves the GitLab repository alone unless explicitly asked
  — this tool tracks repositories, it does not own them.
