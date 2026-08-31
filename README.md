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

Three processes: Postgres, Django, Next.js. Redis is a fourth and is optional —
without it the cache falls back to per-process local memory and everything still
works.

```bash
# 1. Database
docker run -d --name pms-postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=pms \
  -p 5432:5432 postgres:16-alpine

# 1b. Cache (optional, but run it if more than one person uses this)
docker run -d --name pms-redis -p 6379:6379 redis:7-alpine

# 2. Backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
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

## Deploying somewhere air-gapped

Three things reach the network at install or build time and will need handling.

**Python dependencies.** `openpyxl` and `et-xmlfile` are needed for the Excel
reports, and `redis` for the cache. Vendor the wheels
(`pip download -r requirements.txt -d wheels/`) on a connected machine and
install with `pip install --no-index --find-links wheels/`.

**Redis is optional.** If there is no Redis on the target, leave `REDIS_URL`
blank: the cache falls back to per-process local memory, every read path behaves
identically, and the only loss is that two Gunicorn workers keep separate copies
and separate version counters. The app also survives Redis being *configured and
unreachable* — every cache call is treated as a miss rather than an error — so a
Redis that goes down makes the app slow, never broken.

**Fonts.** `next/font/google` downloads Bricolage Grotesque, Public Sans and
JetBrains Mono **at build time**. A build on a machine with no route to
`fonts.gstatic.com` will fail or stall. Either build on a connected machine and
ship `.next`, or vendor the woff2 files into `public/fonts/` and swap
`next/font/google` for `next/font/local` in `app/layout.tsx`.

**GitLab itself.** `GITLAB_URL` points at the internal instance, and the OAuth
application and group access token are created there. Nothing else in the app
calls out.

Self-hosted GitLab also means an older API than gitlab.com. Two places were
written for that: work items are read unfiltered and narrowed locally rather
than with `issue_type` on the query, and milestones ask for ancestors but do not
depend on getting them. If a plan still looks wrong, `inspect_gitlab` prints
exactly what that server returned.

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

### The delivery lifecycle

A project sits on one of nine phases, in order:

**Draft** → Requirement Gathering → Development → Testing → Deployment → UAT →
Production → Maintenance → **Closed**

The order is the point. Position in the list *is* progress, which is why the
screen draws a ladder rather than printing a label — "how far along is this" is
the question somebody has on opening a project, and a name alone cannot answer
it. The sequence is declared once, in `ProjectStatus`, and served from
`/api/projects/phases/` so the picker has no copy of its own.

Counts of "active" mean **in flight**: anything that is neither Draft nor
Closed. There is no single active phase any more, and seven of the nine are work
under way.

Only the project's owner can move it on. The old five states migrate across —
`active` becomes Development, `completed` and `archived` become Closed. `on_hold`
is the one with no successor, since a lifecycle has no paused state; those land
back on Draft and are worth re-checking by hand.

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

### Tasks are work items, not issues

A task here is a GitLab **work item of type task**, not an issue. Both live
behind one REST endpoint — `/issues` carries every work item type, selected with
`issue_type` — which is why the client's paths still read "issues".

They are kept apart for the person using GitLab: planning done in this tool
lands under **Tasks**, where it belongs, instead of filling the Issues tab.

Reading is deliberately wider than writing, and does **no type filtering at
all**. The work item list is fetched unfiltered and narrowed locally, because the
GitLab versions disagree: work item types did not always exist, `issue_type` was
not always a valid filter, and a server that does not recognise a query parameter
is as likely to ignore it as to reject it. Asking for everything and choosing
locally cannot silently return nothing.

What separates planning from noise is the **milestone**, not the type:

- filed under a milestone this project can see → read, whatever type it is
- filed under nothing → left alone, and counted
- filed under a milestone this project cannot see → left alone, and named

Anything that came across as an issue is labelled *issue* in the plan rather than
quietly called a task.

#### When the plan looks empty

A sync that reads sixty work items and keeps none looks identical to one that
found nothing, so it says which. **Sync with GitLab** reports what it dropped and
why, and `reconcile` returns `read`, `skipped_no_milestone`,
`skipped_unknown_milestone` and `unmatched_milestones` alongside the counts.

To see the payloads themselves — read-only, no writes, safe against production:

```bash
python manage.py inspect_gitlab <project id>          # what GitLab returns
python manage.py inspect_gitlab <project id> --raw    # plus one item in full
```

It prints every milestone with its scope, every work item with its type,
milestone and assignee, and then what this tool would keep and what it would
drop. If the plan on screen disagrees with the plan in GitLab, that output
settles it.

A task takes `milestone_id` directly, so Milestone → Task needs no parent link —
just as well, since REST cannot make a task the child of an issue (it comes out
"related" instead).

#### Syncing a plan made in GitLab

Opening a project reconciles it, which is enough while you are working in one.
**Sync with GitLab**, on the Projects tab, does every project at once — for a
repository whose plan was built in GitLab and which this tool has never opened,
where the list would otherwise report an empty plan for work that is visibly
there.

The loop runs in the browser, a few projects at a time, so the button counts up
rather than spinning: each project is several round trips to GitLab, and across a
dozen of them a silent spinner stops being credible.

Milestones are read with `include_ancestors`, so a team that plans at the
**group** level is not reported as having no plan. A group milestone is shown
with a *from the group* tag and cannot be edited or deleted here — it is shared
with the group's other projects, and the project's own endpoint cannot reach it
anyway.

If a project was planned before the task/issue split, its work is sitting in
GitLab as plain issues and nothing reads them any more. Convert it once:

```bash
python manage.py convert_issues_to_tasks --dry-run   # say what would change
python manage.py convert_issues_to_tasks             # do it
```

Only rows this tool created are touched — each is a Task in the database with a
GitLab iid — so an issue somebody opened by hand is never in scope. Safe to run
twice.

### Milestones and tasks

Milestones are squares in a grid, each with its task count inside its own
progress ring — so "eight tasks, most of them done" is one glance rather than a
number and then a bar to interpret. Opening one shows its tasks below: who has
each, what is overdue, how many are unassigned.

One opens at a time. A stack of expanded milestones answers "what is in
milestone three" and nothing else — the shape of the whole plan is off the
bottom of the screen by the second one, and comparing two task lists side by
side is not something anybody does.

Two levels. A milestone holds tasks directly, and each task carries one assignee
— multiple assignees is a Premium feature, and a third level would mean
maintaining a hierarchy in Postgres that GitLab's REST API will not maintain for
us.

Writes go upstream first and are mirrored locally only once GitLab accepts them,
so the board can never show a task that does not exist in GitLab. Opening a
project reconciles the other way, so a task closed in GitLab's own UI is
reflected here rather than silently overwritten — **and its todo is ticked
off**, because they are the same piece of work.

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

#### General

Every owner has one team they did not make, called **General**: everyone on
every team they keep, offered alongside the real ones wherever a team is picked
— creating a project, running the round.

It holds no memberships of its own. The roster is worked out on read from the
other teams, because copying every join and leave into a second table means the
copy is wrong the first time a sync is missed, and a roster that is quietly
wrong leaves people off projects. Nothing can be added to General directly, and
it cannot be renamed or deleted; it sorts last so a dropdown still defaults to a
real team rather than to everybody.

### Members, both directions

Adding somebody to a project here puts them on the **GitLab repository** too, at
`MEMBER_ACCESS_LEVEL`, and cuts them a standing branch (`dev/<handle>`). That has
always been the case — a project member who cannot push is not a member.

The other direction is **Import from repository**, on the project page. It reads
who is already on the repository and brings them onto the project, keeping the
access level GitLab gave them rather than levelling everybody to the default. It
runs automatically when an existing repository is linked, since the people are
the reason it already existed.

Direct members only, not people who inherit access through the group: inherited
access is real, but importing it would put every member of a twenty-person group
onto every repository the group owns, which is not what anyone means by "who is
on this project".

Somebody on the repository who has never signed in here cannot be added — there
is no account to attach work to. They are named in the result so the owner can
send them an invite link rather than wonder why the count
disagrees with GitLab.

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

### Reports

A daily or weekly window, on screen and as a real spreadsheet. Both come from
one builder — two code paths producing "the same" report is how the file ends up
disagreeing with the page it was exported from, and the file is the copy that
gets forwarded to somebody who will never open this app.

Six sheets: **Summary**, **Projects** (status, progress, what closed in the
window, what is still missing from setup), **People**, **Who is where** (one row
per person per project, with the branch they own on it), **Milestones**, and
**Day by day**.

Not a CSV with a different extension: dates are real dates so they sort and
filter, percentages are real percentages so conditional formatting works, and
every table is frozen and filterable, because a hundred rows with nothing pinned
is a table nobody scrolls.

**Bandwidth** is open GitLab tasks plus open todos, with overdue work counted
twice, against a nominal `CAPACITY_OPEN_ITEMS` per person. Overdue counts double
because something a week late is not the same weight as something due Friday,
and a straight count says it is. The number is a heuristic for spotting who to
talk to, and both the page and the spreadsheet say so rather than presenting it
as a measurement of the person.

A weekly report runs Monday to Sunday but never past today — a Wednesday export
claiming to cover Friday would show three days of zeros and read as the team
having stopped.

---

## Why it feels fast

Three separate problems, and caching only solved one of them.

**The screen no longer waits for the write.** Ticking a todo used to be: send
the request, wait, call `router.refresh()`, wait for the whole route to
re-render from six endpoints. Two serial round trips before a tick mark moved.
Now the screen changes on the same frame as the click and the request goes
afterwards — `lib/actions.ts` sends it, `components/Activity.tsx` holds the
state. Every optimistic change is a local override that is thrown away whole the
moment fresh server props arrive, so the server's answer always wins and there
is no reconciliation logic to get subtly wrong.

**Refreshes are shared and late.** A burst of ticks used to be a burst of full
route re-renders racing each other. `refreshSoon()` coalesces them into one,
fired once the burst stops.

**Reads are cached, and invalidated by the models rather than by the views.**
`core/cache.py` keys every cached payload on the current version number of each
scope it was built from; invalidating a scope increments that number and strands
the old keys, which is one integer write no matter how many keys it covers.
`core/invalidation.py` wires those bumps to `post_save`/`post_delete` rather than
to the endpoints that write, because writes also happen in services, in
management commands, in the GitLab reconcile and in cascade deletes, and every
path somebody forgets is a screen showing yesterday's numbers with no error
anywhere. (`bulk_create` fires no signals; the two places that use it bump by
hand, and say so.)

Measured on the overview, which is the heaviest screen in the app:

| | cold | warm |
|---|---|---|
| `/api/dashboard`, 12 people | 51 queries | 0 |
| `/api/projects/` | 9 queries | 0 |

The cold number came down too, from 88, by grouping what used to be several
queries per person into a fixed few — see `ensure_days` and the count
annotations in `projects/dashboard.py`.

**Opening a project no longer talks to GitLab first.** That reconcile was
awaited during the server render, so the slowest thing in the app ran before a
single pixel appeared *and* again on every refresh of that screen. It now runs
from `<ReconcileOnOpen />` after the page is drawn, is throttled server-side to
once per `RECONCILE_THROTTLE_SECONDS` per project, and only triggers a refresh
if something actually came back changed. The Sync button sends `force` and
always goes to GitLab, because a person who presses Sync and is told "synced"
without a request leaving the building has been lied to.

## When a write fails after you were told it worked

That is the bargain of an optimistic UI, and this is how it is honoured.

The failure lands in the **notification tab** at the bottom of the rail, named
in the words the button used — "Could not close “Fix login”", not "PATCH
/api/daily/todos/41 returned 500" — with what the server said and a **Try
again** that replays the exact request. A retry that works marks the line as
come good rather than deleting it, so somebody who saw the badge can find out
what became of it.

Failures are recorded in two places on purpose. The server holds them so they
survive a reload and appear on the person's other machine; the browser holds a
copy in `localStorage` because the most common reason a write fails is that the
server was unreachable, in which case filing it there fails too. The local copy
is dropped once the server has taken it, and the tray shows the union.

Requests are retried automatically before anyone is told: three attempts with
backoff, but only for the failures that could plausibly go differently — a
network drop, a 5xx, a 429. A 403 or a 404 is the server saying the request
itself is wrong, and sending it twice more only makes the app feel broken
instead of honest.

`retry_path` is validated on the way in and on the way out: relative, and under
`/api/`. It is stored and later fetched by the browser, so an absolute URL there
would be a way to make somebody's session call somewhere else.

## Ticking is one click; unticking asks

Ticking means finished, whoever does it. There was a two-stage version — a
member's tick only *claimed* a line and an owner closed it in the morning
meeting — and it is gone. It made ticking your own work feel like filing a
request, and reopening a closed line cleared `done_at` but left `claimed_at`
behind, so the line came back reading "marked done by … · waiting to be closed"
instead of open. `daily/migrations/0003` drops the columns and closes anything
that was mid-flight, crediting whoever ticked it.

Reversing a tick opens a confirmation; taking one does not. They are the same
button in the same place, and on a list of finished lines a stray click
otherwise silently reopens work the morning meeting has already been told about.
A dialog in front of only the reversal costs nothing on the action people take
twenty times a day and catches the one they take by accident. It applies
wherever a tick can be reversed: a todo on My day, a line in the round, a task
in the plan, and a resolved issue — the last two say that they reopen the item
in GitLab too.

## Issues, raised against a task

A task is work somebody planned. An issue is a problem found while doing it.
They are deliberately different lists: if every defect became a task, a
milestone's progress would go backwards every time somebody found a bug, which
is precisely when you least want the plan to start lying.

Every task carries a flag — faint until something is open against it, then
filled with a count. Anyone who can see the project can log one, which is the
point: the person who finds a defect is almost never the person who planned the
work, and a tool that makes them ask someone else to file it is a tool where
defects do not get filed. Resolving is narrower — the owner, the assignee, or
whoever raised it.

**Where it is filed depends on the task.** A task that exists in GitLab gets a
real GitLab issue (`issue_type=issue`, not `task`). A task that only exists here
— a project with no repository, or a GitLab write that never landed — gets an
issue held in this database. Same row, same screen; `is_in_gitlab` is the only
difference anybody sees.

Three things about the GitLab side, all of them decided by what a **self-managed
Free** instance can actually do:

- **`assignee_id`, singular.** `assignee_ids` is Premium and up.
- **The cross-reference is the real link.** The issue description ends with
  `Raised against #<task_iid>`. A bare `#iid` has produced a cross-reference on
  every tier and every version for as long as GitLab has existed, so the two are
  findable from each other whatever the server is.
- **The formal link is an upgrade, not a dependency.** `POST
  /issues/:iid/links` with `link_type=relates_to` is attempted afterwards and
  allowed to fail — related issues are Free on current GitLab but were not
  always, and `blocks`/`is_blocked_by` are still Premium, so `relates_to` is the
  only type ever asked for. `Issue.is_linked` records whether it landed.

## What a member sees

Members get **My day** and **Projects**. On a project they can read the plan,
its milestones, the tasks under each, and the issues raised across it, and they
can log and resolve issues. They cannot change the plan: no milestone or task
creation, no phase change, no membership or document controls, no delete. That
is the same `canEdit={user.is_owner}` the project screens already used — the
only change was giving them the tab.

## Layout

```
backend/
  accounts/    users, roles, GitLab OAuth, JWT rotation
  gitlab_api/  REST client and OAuth flow
  teams/       an owner's standing roster
  projects/    projects, repositories, branches, documents, readiness
  planning/    milestones and tasks, two-way with GitLab
  daily/       todos, carry-forward, the morning meeting
  reports/     the daily and weekly workbook (no models)
frontend/src/
  middleware.ts  silent token refresh, CSRF top-up, signed-out redirects
  app/join/      the other end of an invite link
  app/auth/      where GitLab's round trip lands
  app/(app)/     today, projects, team, morning meeting, reports, my day
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
