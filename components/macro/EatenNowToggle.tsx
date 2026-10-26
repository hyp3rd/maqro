"use client";

import { SegmentedControl } from "../ui/segmented-control";

/** The add flow's choice on today: food added now was eaten now (it gets
 *  the time), or is for later (planned, untimed until "Ate it"). The page
 *  holds it, so it carries from the log launcher into the tool it opens,
 *  and sets it back to eaten now once the add flow closes. Absent on
 *  another day: a past day's food has no true hour, a future day's is all
 *  plan. */
export type LaterChoice = {
  later: boolean;
  onLaterChange: (later: boolean) => void;
};

/** "Eaten now / Later", as a two-option radio group. */
export function EatenNowToggle({
  choice,
  className,
}: {
  choice: LaterChoice;
  className?: string;
}) {
  return (
    <SegmentedControl
      aria-label="When you eat it"
      value={choice.later ? "later" : "now"}
      onValueChange={(value) => choice.onLaterChange(value === "later")}
      options={[
        { value: "now", label: "Eaten now" },
        { value: "later", label: "Later" },
      ]}
      className={className}
    />
  );
}
