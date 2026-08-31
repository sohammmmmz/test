import { redirect } from "next/navigation";
import { IssueBoard } from "@/components/IssueBoard";
import { Empty } from "@/components/ui";
import { api, ApiError, currentUser } from "@/lib/api";
import type { Issue, User } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Every issue anybody can see, in one place.
 *
 * The per-task dialog is where a problem gets *recorded* — at the moment it is
 * found, next to the work it concerns. This is where the pile gets *worked*,
 * and the two want opposite things: the dialog is narrow and immediate, this is
 * wide and sortable.
 *
 * It deliberately includes issues raised against a line on somebody's day, which
 * belong to no project and are therefore reachable from nowhere else. Those were
 * the ones with no home before this page existed.
 */
export default async function IssuesPage() {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");

  let issues: Issue[] = [];
  // Only an owner can read the directory, and only an owner hands work to
  // somebody else — a member can resolve what they can see, which is the part
  // that matters for getting a defect off the list.
  let people: User[] = [];
  try {
    [issues, people] = await Promise.all([
      api.get<Issue[]>("/api/planning/issues/"),
      user.is_owner
        ? api.get<User[]>("/api/teams/directory").catch(() => [])
        : Promise.resolve([]),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/sign-in?next=/issues");
    }
    return (
      <div className="page-body">
        <Empty title="Could not load the issues" body="The server did not respond." />
      </div>
    );
  }

  return <IssueBoard initial={issues} people={people} canReassign={user.is_owner} />;
}
