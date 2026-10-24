import { createLucideIcon } from "lucide-react";

/** Today's nav glyph: two concentric rings, from the Instrument design's
 *  tab bar (the day's gauge reduced to an icon). Lucide has no two-ring
 *  icon (CircleDot is a ring and a dot, Target three rings), so it is built
 *  with lucide's own factory: same 24px grid, stroke and props as every
 *  other nav icon. */
export const TodayRings = createLucideIcon({
  name: "today-rings",
  size: 24,
  node: [
    ["circle", { cx: "12", cy: "12", r: "8.5", key: "outer" }],
    ["circle", { cx: "12", cy: "12", r: "3.5", key: "inner" }],
  ],
});
