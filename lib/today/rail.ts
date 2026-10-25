import type { Meal } from "@maqro/core/types";
import type { RelativeDay } from "./timeline";

/** The Today meal rail: one node per meal slot, echoing the timing track.
 *  On today, "next to log" (`RailEntry.next`) is the first slot that isn't
 *  LOGGED and is still ahead: a planned one wherever it sits (its food is
 *  still to log — a planned dinner before an afternoon snack logged in the
 *  last slot), or an empty one after the last logged slot. An empty slot
 *  skipped before a logged one is not next.
 *
 *  - `logged`: the slot has food that was logged as eaten (a filled node).
 *  - `planned`: the slot's food is intent, not a record — on today or a
 *    future day, none of its foods carries a `loggedAt`. Every path the UI
 *    presents as logging stamps one on today (search, recipe, template,
 *    a scheduled recipe, "Log this day", a photo), so this is the Meals
 *    card's AI Auto-fill, the demo's later meals, or anything put on a
 *    future day. A distinct node, and
 *    no time on the rail or the track. A past day can't tell the two apart
 *    (logging to another day never stamps a time), so its food reads as
 *    logged.
 *  - `open`: an empty slot — skipped, still to come, or on a past or
 *    future day (a hollow node). */
export type RailNode = "logged" | "planned" | "open";

export type RailEntry = {
  node: RailNode;
  /** Today's next slot to log (the highlighted node): open or planned. */
  next: boolean;
  /** The rail line below this node is drawn solid: a later slot is logged,
   *  so the day has already run past it (a planned slot is still ahead). */
  lineStrong: boolean;
};

export function railNodes(
  meals: readonly Meal[],
  when: RelativeDay,
): RailEntry[] {
  const filled = meals.map((m) => m.foods.length > 0);
  const logged = meals.map(
    (m, i) =>
      (filled[i] ?? false) &&
      (when === "past" || m.foods.some((f) => f.loggedAt !== undefined)),
  );
  const lastLogged = logged.lastIndexOf(true);
  const nextIndex =
    when === "today"
      ? meals.findIndex(
          (_, i) => !logged[i] && ((filled[i] ?? false) || i > lastLogged),
        )
      : -1;
  return meals.map((_, i) => ({
    node: logged[i] ? "logged" : filled[i] ? "planned" : "open",
    next: i === nextIndex,
    lineStrong: i < lastLogged,
  }));
}
