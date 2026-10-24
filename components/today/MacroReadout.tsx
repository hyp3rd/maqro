"use client";

import { meterReading } from "@/components/ui/meter";
import { Stat } from "@/components/ui/stat";
import { formatNumber } from "@/lib/i18n/number";
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
 *  calorie row leaves "left" to the gauge's centre. Locale-aware figures. */
export function MacroReadout({
  eaten,
  targets,
  className,
}: {
  eaten: Macros;
  targets: Targets;
  className?: string;
}) {
  const locale = useLocale();
  const show = (n: number) => formatNumber(n, locale);

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
            className="gap-y-0"
            label={
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn("h-1 w-2.5 shrink-0 rounded-full", row.swatch)}
                />
                {row.label}
              </span>
            }
            value={show(reading.value)}
            unit={
              reading.target !== null
                ? `/ ${show(reading.target)} ${row.unit}`
                : row.unit
            }
            detail={detail}
          />
        );
      })}
    </dl>
  );
}
