"use client";

import { meterReading } from "@/components/ui/meter";
import { Stat } from "@/components/ui/stat";
import { formatNumber } from "@/lib/i18n/number";
import type { RelativeDay } from "@/lib/today/timeline";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";

type Macros = { calories: number; protein: number; carbs: number; fat: number };
type Targets = {
  targetCalories: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** The four rows, in the gauge's ring order (energy, then protein outer to
 *  fat inner), each with the swatch of its arc. */
const ROWS = [
  {
    key: "calories",
    label: "Eaten",
    unit: "kcal",
    swatch: "bg-brand",
    target: (t: Targets) => t.targetCalories,
  },
  {
    key: "protein",
    label: "Protein",
    unit: "g",
    swatch: "bg-macro-protein",
    target: (t: Targets) => t.protein,
  },
  {
    key: "carbs",
    label: "Carbs",
    unit: "g",
    swatch: "bg-macro-carbs",
    target: (t: Targets) => t.carbs,
  },
  {
    key: "fat",
    label: "Fat",
    unit: "g",
    swatch: "bg-macro-fat",
    target: (t: Targets) => t.fat,
  },
] as const;

/** The mono readout beside the Today gauge: "Eaten 1,240 / 2,500 kcal",
 *  then "Protein 85 / 160 g · 75 g left" and so on. Figures are rounded
 *  before they are compared (`meterReading`), so "left" and "+N" always
 *  match the numbers shown; over is a neutral "+N", never a warning. The
 *  calorie row leaves "left" to the gauge's centre. Locale-aware figures.
 *  On a future day (`when`) nothing is eaten yet: the logged food is a
 *  plan, so the energy row reads "Planned" (the gauge says "to plan").
 *  Today's planned food (`planned`) is stated under the energy figure:
 *  how much is planned, then where the day lands with it — two short
 *  lines, so each fits a cell of the 2 × 2 readout on a 320 px phone. */
export function MacroReadout({
  eaten,
  planned,
  targets,
  when = "today",
  className,
}: {
  eaten: Macros;
  /** Today's planned food (`dayIntake`). */
  planned?: Macros;
  targets: Targets;
  when?: RelativeDay;
  className?: string;
}) {
  const locale = useLocale();
  const show = (n: number) => formatNumber(n, locale);
  const plannedKcal = Math.round(planned?.calories ?? 0);

  return (
    <dl className={cn("grid content-center gap-y-2", className)}>
      {ROWS.map((row) => {
        const reading = meterReading(eaten[row.key], row.target(targets), 0);
        const left =
          reading.target !== null
            ? Math.max(reading.target - reading.value, 0)
            : null;
        const detail =
          row.key === "calories" || reading.target === null
            ? undefined
            : reading.over > 0
              ? `+${show(reading.over)} ${row.unit}`
              : left !== null && left > 0
                ? `${show(left)} ${row.unit} left`
                : "on target";
        return (
          <Stat
            key={row.key}
            size="md"
            // Each row is its own size container: a cell too narrow for the
            // label and "160 g left" side by side (a 2 × 2 readout on a
            // 320 px phone) puts the detail (the `dd` after the figure's)
            // under the figure instead of clipping the label. The calorie
            // row has no detail, so there its "/ 1,950 kcal" takes that
            // line: every cell is then label, figure, small line, and the
            // figures of a pair share one line. Packed to the top
            // (`content-start`), since the readout's grid stretches each
            // cell to its row's height.
            className={cn(
              "content-start gap-y-0 @container @max-[9.5rem]:[&>dd+dd]:col-span-2 @max-[9.5rem]:[&>dd+dd]:col-start-1 @max-[9.5rem]:[&>dd+dd]:row-start-3",
              row.key === "calories" &&
                "@max-[9.5rem]:[&>dd:first-of-type>span]:block",
            )}
            label={
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn("h-1 w-2.5 shrink-0 rounded-full", row.swatch)}
                />
                {row.key === "calories" && when === "future"
                  ? "Planned"
                  : row.label}
              </span>
            }
            value={show(reading.value)}
            unit={
              // One unbroken run: a narrow cell wraps "/ 2,000 kcal" whole
              // under the figure rather than stranding "kcal" on a line.
              <span className="whitespace-nowrap">
                {reading.target !== null
                  ? `/ ${show(reading.target)} ${row.unit}`
                  : row.unit}
              </span>
            }
            detail={detail}
          >
            {row.key === "calories" && plannedKcal > 0 ? (
              <span
                data-part="planned"
                className="block font-mono text-xs tabular-nums text-muted-foreground"
              >
                <span className="block">+{show(plannedKcal)} planned</span>{" "}
                <span className="block">
                  {show(reading.value + plannedKcal)} after plan
                </span>
              </span>
            ) : undefined}
          </Stat>
        );
      })}
    </dl>
  );
}
