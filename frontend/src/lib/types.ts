export type Role = "owner" | "member";

export type User = {
  id: number;
  username: string;
  email: string;
  display_name: string;
  first_name: string;
  last_name: string;
  gitlab_user_id: number | null;
  gitlab_username: string;
  gitlab_avatar_url: string;
  role: Role | "";
  department: string;
  job_title: string;
  is_onboarded: boolean;
  is_owner: boolean;
};

export type AuthConfig = {
  gitlab_url: string;
  oauth_configured: boolean;
  service_token_configured: boolean;
  group_configured: boolean;
  roles: { value: string; label: string }[];
  departments: { value: string; label: string }[];
};

export type Progress = {
  total_tasks: number;
  completed_tasks: number;
  percent: number;
  overdue_milestones: number;
  is_slipping: boolean;
  next_due_date: string | null;
  next_milestone: string | null;
};

export type ReadinessCheck = {
  key: string;
  label: string;
  passed: boolean;
  remedy: string;
};

export type Readiness = {
  checks: ReadinessCheck[];
  passed: number;
  total: number;
  is_ready: boolean;
};

export type Phase = { value: string; label: string; index: number };

export type Project = {
  id: number;
  name: string;
  slug: string;
  description: string;
  status: string;
  status_display: string;
  // Position in the delivery lifecycle. The order lives on the backend; these
  // two are what a screen needs to draw it without keeping a copy.
  phase_index: number;
  phase_count: number;
  is_in_flight: boolean;
  owner: User;
  team_name: string | null;
  repo_path: string | null;
  repo_url: string | null;
  started_on: string | null;
  target_end_on: string | null;
  progress: Progress;
  readiness: Readiness;
  member_count: number;
  created_at: string;
};

export type ProjectMember = {
  id: number;
  user: User;
  branch_name: string;
  access_level: number;
  synced_to_gitlab: boolean;
  sync_error: string;
};

export type ProjectDocument = {
  id: number;
  kind: "brd" | "technical";
  kind_display: string;
  filename: string;
  repo_path: string;
  size_bytes: number;
  commit_sha: string;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

export type ProjectDetail = Project & {
  repo: {
    gitlab_project_id: number;
    path_with_namespace: string;
    web_url: string;
    http_url_to_repo: string;
    default_branch: string;
    visibility: string;
    documentation_branch: string;
    docs_branch: string;
    documentation_branch_ready: boolean;
    created_by_app: boolean;
  } | null;
  members: ProjectMember[];
  documents: ProjectDocument[];
  warnings?: string[];
};

export type Task = {
  id: number;
  gitlab_iid: number | null;
  title: string;
  description: string;
  state: "opened" | "closed";
  assignee: User | null;
  due_date: string | null;
  labels: string[];
  web_url: string;
  is_overdue: boolean;
  milestone: number;
  milestone_title: string;
  // "task" or "issue" — what GitLab made it. Anything filed under a milestone
  // counts as planned work whichever it is.
  work_item_type: string;
  project_id: number;
  project_name: string;
  closed_at: string | null;
  created_at: string;
};

export type Milestone = {
  id: number;
  project: number;
  project_name: string;
  gitlab_iid: number | null;
  title: string;
  description: string;
  state: "active" | "closed";
  start_date: string | null;
  due_date: string | null;
  web_url: string;
  // Owned by a parent group, so it can hold this project's work but cannot be
  // edited or deleted through the project.
  is_inherited: boolean;
  tasks: Task[];
  progress: { total: number; done: number; percent: number };
  is_overdue: boolean;
  days_remaining: number | null;
  created_at: string;
};

export type Todo = {
  id: number;
  user: number;
  user_name: string;
  date: string;
  title: string;
  notes: string;
  task: Task | null;
  source: "carried" | "task" | "meeting" | "manual";
  // Two stages, not one flag. "claimed" is the person saying it is finished;
  // "closed" is the owner confirming it in the morning meeting.
  status: "open" | "claimed" | "closed";
  is_done: boolean;
  done_at: string | null;
  closed_by_name: string | null;
  is_claimed: boolean;
  claimed_at: string | null;
  claimed_by_name: string | null;
  is_stale: boolean;
  age_days: number;
  carry_count: number;
  first_added_on: string | null;
  created_at: string;
};

export type DayView = {
  date: string;
  is_working_day?: boolean;
  counts: { total: number; done: number; claimed: number; carried: number; stale: number };
  todos: Todo[];
  suggestions: Task[];
  open_tasks: Task[];
  user?: User;
};

export type Team = {
  id: number;
  name: string;
  description: string;
  owner: User;
  members: { id: number; user: User; joined_on: string; left_on: string | null; is_active: boolean }[];
  member_count: number;
  // The catch-all: everyone on every other team this owner keeps. It has no
  // roster of its own, so nobody can be added to it directly.
  is_general: boolean;
  created_at: string;
};

export type MeetingNote = {
  id: number;
  attended: boolean;
  blockers: string;
  notes: string;
  is_reviewed: boolean;
};

export type Meeting = {
  id: number;
  team: number;
  team_name: string;
  owner: User;
  date: string;
  status: "not_started" | "in_progress" | "completed";
  started_at: string | null;
  completed_at: string | null;
  current_index: number;
  summary: string;
  duration_minutes: number | null;
  notes: (MeetingNote & { user: User })[];
};

export type LastMeeting = {
  date: string;
  attended: boolean;
  blockers: string;
  notes: string;
  todos: Todo[];
  total: number;
  closed: number;
  still_open: number;
  days_ago: number;
};

export type MeetingRow = {
  user: User;
  is_owner: boolean;
  note: MeetingNote | null;
  pending: Todo[];
  claimed: Todo[];
  done: Todo[];
  suggestions: Task[];
  overdue_tasks: Task[];
  stale_count: number;
  last_meeting: LastMeeting | null;
};

export type MeetingBoard = {
  meeting: Meeting;
  rows: MeetingRow[];
};

export type WorkloadRow = {
  user: User;
  is_you: boolean;
  open_tasks: number;
  overdue_tasks: number;
  todos_total: number;
  todos_pending: number;
  todos_awaiting: number;
  todos_stale: number;
  project_count: number;
};

export type Dashboard = {
  date: string;
  totals: {
    projects: number;
    active_projects: number;
    slipping: number;
    not_ready: number;
    people: number;
    open_tasks: number;
  };
  projects: Project[];
  slipping: { id: number; name: string; overdue: number }[];
  not_ready: { id: number; name: string; missing: string[] }[];
  workload: WorkloadRow[];
  upcoming_milestones: {
    id: number;
    title: string;
    project_id: number;
    project: string;
    due_date: string;
    days_remaining: number | null;
    is_overdue: boolean;
    total: number;
    done: number;
  }[];
};

export type Alerts = {
  date: string;
  pending_count: number;
  awaiting_count: number;
  done_count: number;
  stale: Todo[];
  pending: Todo[];
  awaiting: Todo[];
  overdue_tasks: Task[];
};

export type InviteDetails = {
  valid: boolean;
  reason: "active" | "expired" | "used up" | "revoked" | "unknown";
  team: string;
  invited_by: string;
};

export type TeamInvite = {
  id: number;
  token: string;
  url: string;
  note: string;
  state: "active" | "expired" | "used up" | "revoked";
  is_usable: boolean;
  uses: number;
  max_uses: number | null;
  expires_at: string | null;
  created_by_name: string;
  created_at: string;
};

export type AvailableRepo = {
  gitlab_project_id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  default_branch: string | null;
  visibility: string;
  last_activity_at: string | null;
  /** Set when another project already uses this repository. */
  linked_to: string | null;
};

export type RepoBranch = { name: string; is_default: boolean };

/* --------------------------------------------------------------------------
   Reports
   -------------------------------------------------------------------------- */

export type ReportSummary = {
  generated_at: string;
  generated_by: string;
  kind: "daily" | "weekly";
  label: string;
  start: string;
  end: string;
  projects: number;
  active_projects: number;
  slipping: number;
  not_ready: number;
  people: number;
  over_capacity: number;
  idle: number;
  open_tasks: number;
  overdue_tasks: number;
  tasks_closed: number;
  todos_closed: number;
  todos_awaiting: number;
  meetings_held: number;
  capacity_basis: number;
};

export type ReportProject = {
  name: string;
  status: string;
  is_active: boolean;
  phase: number;
  phase_of: number;
  repository: string;
  repo_url: string;
  team: string;
  owner: string;
  people: number;
  milestones: number;
  milestones_closed: number;
  tasks: number;
  tasks_done: number;
  percent: number;
  overdue_milestones: number;
  is_slipping: boolean;
  next_milestone: string;
  next_due: string | null;
  started_on: string | null;
  target_end_on: string | null;
  setup: string;
  missing: string;
  closed_in_period: number;
};

export type ReportPerson = {
  name: string;
  gitlab_username: string;
  department: string;
  job_title: string;
  role: string;
  projects: number;
  project_names: string;
  open_tasks: number;
  overdue_tasks: number;
  tasks_closed_in_period: number;
  todos_open_today: number;
  todos_in_period: number;
  todos_closed: number;
  todos_awaiting: number;
  todos_carrying: number;
  todos_stale: number;
  load: number;
  bandwidth_percent: number;
  bandwidth: "Free" | "Spare capacity" | "Steady" | "Full" | "Over capacity";
};

export type ReportAssignment = {
  project: string;
  project_status: string;
  person: string;
  department: string;
  branch: string;
  on_gitlab: string;
  open_tasks: number;
  overdue_tasks: number;
  closed_in_period: number;
};

export type ReportMilestone = {
  project: string;
  milestone: string;
  state: string;
  start_date: string | null;
  due_date: string | null;
  days_remaining: number | null;
  is_overdue: boolean;
  tasks: number;
  tasks_done: number;
  percent: number;
  closed_in_period: number;
};

export type ReportActivity = {
  date: string;
  weekday: string;
  is_working_day: boolean;
  todos: number;
  closed: number;
  awaiting: number;
  still_open: number;
  tasks_closed: number;
  meetings: number;
};

export type ReportPreview = {
  period: { kind: "daily" | "weekly"; label: string; start: string; end: string; days: number };
  filename: string;
  summary: ReportSummary;
  projects: ReportProject[];
  people: ReportPerson[];
  assignments: ReportAssignment[];
  milestones: ReportMilestone[];
  activity: ReportActivity[];
};
