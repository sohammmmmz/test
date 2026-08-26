import { redirect } from "next/navigation";
import { TodoList } from "@/components/TodoList";
import { api, ApiError, currentUser } from "@/lib/api";
import { longDate, plural, weekday } from "@/lib/format";
import type { DayView, User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyDayPage() {
  const user = await currentUser<User>();
  if (!user) redirect("/sign-in");

  let day: DayView;
  try {
    day = await api.get<DayView>("/api/daily/my-day");
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/sign-in?next=/my-day");
    }
    throw err;
  }

  const left = day.counts.total - day.counts.done;
  const headline =
    day.counts.total === 0
      ? "Nothing on the list yet."
      : left === 0
        ? "That's everything. Nice."
        : `${left} ${plural(left, "thing")} left today.`;

  return (
    <>
      <header className="page-head dawn">
        <div className="stack gap-2">
          <span className="eyebrow">{weekday(day.date)} · {longDate(day.date)}</span>
          <h1>{headline}</h1>
          <p className="soft" style={{ fontSize: ".93rem", maxWidth: "50ch" }}>
            {day.counts.carried > 0
              ? `${day.counts.carried} ${plural(day.counts.carried, "item")} carried over from last time.`
              : "Everything here was added today."}
          </p>
        </div>
      </header>

      <div className="page-body">
        <TodoList
          todos={day.todos}
          suggestions={day.suggestions}
          date={day.date}
          canAdd
          canTick
          title="Today"
        />
      </div>
    </>
  );
}
