import { addDays } from "@maqro/core/date";
import { localDate } from "./timeline";

/** A day as the user reads it: "Today", "Yesterday", else the short local
 *  date ("Mon, Jun 2"). The log launcher names the day it logs into with
 *  it ("Lunch · Today"), so it never claims "Today" while another day is
 *  on screen. */
export function formatDayLabel(d: string, today: string): string {
  if (d === today) return "Today";
  if (d === addDays(today, -1)) return "Yesterday";
  return localDate(d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
