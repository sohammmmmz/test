import { redirect } from "next/navigation";
import { ActivityProvider } from "@/components/Activity";
import { Rail } from "@/components/Rail";
import { Toasts } from "@/components/Toasts";
import { currentUser } from "@/lib/api";
import type { User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");
  if (!user.is_onboarded) redirect("/welcome");

  // The provider wraps the rail as well as the page, because the notification
  // tray lives in the rail and the toasts are raised from the page. One shared
  // instance is also what lets a burst of writes from anywhere on screen settle
  // into a single refresh.
  return (
    <ActivityProvider>
      <div className="shell">
        <Rail user={user} />
        <div className="page">{children}</div>
      </div>
      <Toasts />
    </ActivityProvider>
  );
}
