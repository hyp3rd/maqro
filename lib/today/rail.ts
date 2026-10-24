import type { Meal } from "@maqro/core/types";
import type { RelativeDay } from "./timeline";

/** The Today meal rail: one node per meal slot, echoing the timing track.
 *  Slots carry no planned time, so "now" is positional — on today, the
 *  first empty slot after the last one with food (the next thing to log).
 *
 *  - `logged`: the slot has food that was logged as eaten (a filled node).
 *  - `planned`: the slot's food is intent, not a record — on today or a
 *    future day, none of its foods carries a `loggedAt` (an AI auto-fill,
 *    a template or recipe, the demo's later meals). A distinct node, and
 *    no time on the rail or the track. A past day can't tell the two apart
 *    (logging to another day never stamps a time), so its food reads as
 *    logged.
 *  - `now`: today's next slot to fill (the highlighted node).
 *  - `open`: any other empty slot — skipped, still to come, or on a past or
 *    future day (a hollow node). */
export type RailNode = "logged" | "planned" | "now" | "open";

export type RailEntry = {
  node: RailNode;
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
  const lastFilled = filled.lastIndexOf(true);
  const lastLogged = logged.lastIndexOf(true);
  const nowIndex =
    when === "today"
      ? filled.findIndex((isFilled, i) => !isFilled && i > lastFilled)
      : -1;
  return meals.map((_, i) => ({
    node: logged[i]
      ? "logged"
      : filled[i]
        ? "planned"
        : i === nowIndex
          ? "now"
          : "open",
    lineStrong: i < lastLogged,
  }));
}
