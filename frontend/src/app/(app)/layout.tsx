import { redirect } from "next/navigation";
import { Rail } from "@/components/Rail";
import { currentUser } from "@/lib/api";
import type { User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");
  if (!user.is_onboarded) redirect("/welcome");

  return (
    <div className="shell">
      <Rail user={user} />
      <div className="page">{children}</div>
    </div>
  );
}
