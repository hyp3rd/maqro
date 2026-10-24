import type { Meal } from "@maqro/core/types";
import type { RelativeDay } from "./timeline";

/** The Today meal rail: one node per meal slot, echoing the timing track.
 *  Slots carry no planned time, so "now" is positional — on today, the
 *  first empty slot after the last one with food (the next thing to log).
 *
 *  - `logged`: the slot has food (a filled node).
 *  - `now`: today's next slot to fill (the highlighted node).
 *  - `open`: any other empty slot — skipped, still to come, or on a past or
 *    future day (a hollow node). */
export type RailNode = "logged" | "now" | "open";

export type RailEntry = {
  node: RailNode;
  /** The rail line below this node is drawn solid: a later slot is logged,
   *  so the day has already run past it. */
  lineStrong: boolean;
};

export function railNodes(
  meals: readonly Meal[],
  when: RelativeDay,
): RailEntry[] {
  const logged = meals.map((m) => m.foods.length > 0);
  const lastLogged = logged.lastIndexOf(true);
  const nowIndex =
    when === "today"
      ? logged.findIndex((isLogged, i) => !isLogged && i > lastLogged)
      : -1;
  return logged.map((isLogged, i) => ({
    node: isLogged ? "logged" : i === nowIndex ? "now" : "open",
    lineStrong: i < lastLogged,
  }));
}
