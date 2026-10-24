"use client";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardBody } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { haptic } from "@/lib/haptics";
import { formatNumber } from "@/lib/i18n/number";
import { cn } from "@/lib/utils";
import { useId, useState } from "react";
import { ChevronRight, Minus, Plus, ShieldCheck } from "lucide-react";
import { useLocale } from "next-intl";
import type { DateTargets, WeekTargets } from "@maqro/core/targets";
import {
  CYCLING_PRESETS,
  CYCLING_WEIGHTS,
  DAY_KCAL_STEP,
  PROTEIN_G_PER_KG_MAX,
  PROTEIN_G_PER_KG_MIN,
  fatMovesForDiet,
  normalizeProteinSetting,
  normalizeTrainingSchedule,
} from "@maqro/core/training";
import {
  withProteinSetting,
  withTrainingCycling,
  withTrainingDay,
  withTrainingEnabled,
} from "@maqro/core/training-edit";
import {
  type CyclingPreset,
  MIN_DAILY_KCAL,
  type PersonalInfo,
  type ProteinSetting,
  type TrainingDay,
  type TrainingSchedule,
} from "@maqro/core/types";
import { TrainingDayDialog } from "./TrainingDayDialog";
import { TrainingWeekChart } from "./TrainingWeekChart";
import {
  MONDAY_FIRST,
  TRAINING_TYPE_LABEL,
  WEEKDAY_NAME,
  WEEKDAY_SHORT,
  sessionDetails,
} from "./training-labels";

const CYCLING_LABEL: Record<CyclingPreset, string> = {
  off: "Off",
  modest: "Modest",
  pronounced: "Pronounced",
};

const PROTEIN_STEP = 0.1;

/** A stepper button at its bound: looks disabled, ignores the pointer, and
 *  keeps keyboard focus. */
const STEPPER_BOUND =
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

type Props = {
  profile: PersonalInfo;
  /** Local `YYYY-MM-DD` — marks today's row. */
  today: string;
  /** The week containing today, planned for a profile with the app's
   *  target context (`useTargets().planWeek`). */
  planWeek: (profile: PersonalInfo) => WeekTargets | null;
  onTrainingChange: (next: TrainingSchedule) => void;
  onProteinSettingChange: (next: ProteinSetting) => void;
  /** Opens My measurements, where a body-fat estimate comes from. */
  onOpenMeasurements: () => void;
};

/** `weekTargets` lists Monday → Sunday; `getDay()` puts Sunday first. */
const weekIndex = (weekday: number) => (weekday + 6) % 7;

/** What the cycling choice does to this week, so the line under the
 *  control always matches the chart above it:
 *  - `moves`: days vary around the average;
 *  - `off`: cycling is off;
 *  - `floors`: the engine's `floorsExceedMean` (every day at the average,
 *    by its cause), and whether protein gave way under the setting
 *    (`protein < training.requestedProtein`);
 *  - `sameDays`: cycling is on but every day weighs the same (all rest,
 *    all one class…), so there is nothing to move between them;
 *  - `atFloor` / `atMinimums`: cycling is on but no day can go under the
 *    average: it already sits at the safety floor, max(BMR, 1200), or at
 *    the smallest day that holds the protein, fat and carb minimums. */
type WeekSpread =
  | { kind: "moves" | "off" | "sameDays" | "atFloor" | "atMinimums" }
  | { kind: "floors"; cause: "protein" | "calories"; proteinHeld: boolean };

function weekSpread(
  cycling: CyclingPreset,
  days: readonly DateTargets[],
  current: DateTargets | undefined,
  floor: number,
): WeekSpread {
  const training = current?.training;
  if (training?.floorsExceedMean) {
    return {
      kind: "floors",
      cause: training.floorsExceedMean,
      proteinHeld: (current?.protein ?? 0) < training.requestedProtein,
    };
  }
  if (cycling === "off") return { kind: "off" };
  const flat = days.every(
    (d) => d.targetCalories === (d.training?.meanCalories ?? d.targetCalories),
  );
  if (!flat) return { kind: "moves" };
  const weights = new Set(
    days.map((d) =>
      d.training ? CYCLING_WEIGHTS[cycling][d.training.dayClass] : null,
    ),
  );
  if (weights.size === 1) return { kind: "sameDays" };
  const mean = training?.meanCalories ?? current?.targetCalories ?? 0;
  // Days move in DAY_KCAL_STEP steps: an average less than one step above
  // the safety floor leaves no day room to go under it.
  return mean - floor < DAY_KCAL_STEP
    ? { kind: "atFloor" }
    : { kind: "atMinimums" };
}

/** The training-week editor (FREE): an enable switch, the Monday-first
 *  template with each day's planned calories, the cycling preset with the
 *  calorie-shift chart, and the fixed-protein setting, with notes driven by
 *  the engine's typed flags (`DateTargets.training`).
 *
 *  Reads go through the normalize helpers; every write goes through the
 *  `with*` edit helpers, which change only the edited field of the STORED
 *  value (never this build's normalization of it). Off = no plan: the
 *  targets are exactly what they were without training. */
export function TrainingWeekEditor({
  profile,
  today,
  planWeek,
  onTrainingChange,
  onProteinSettingChange,
  onOpenMeasurements,
}: Props) {
  const locale = useLocale();
  const id = useId();
  const [editing, setEditing] = useState<number | null>(null);
  const schedule = normalizeTrainingSchedule(profile.training);
  const enabled = schedule?.enabled === true;
  const week = enabled ? planWeek(profile) : null;
  const kcal = (n: number) => formatNumber(n, locale);

  const toggle = (on: boolean) => {
    haptic("select");
    onTrainingChange(withTrainingEnabled(profile.training, on));
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Training week
        </h2>
        <p className="text-sm text-muted-foreground">
          Your goal sets the weekly average. Training moves calories between
          days, never on top.
        </p>
      </div>

      <Card>
        <CardBody className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <label
              htmlFor={`${id}-enabled`}
              className="block text-sm font-medium text-foreground"
            >
              Plan targets by training day
            </label>
            <p
              id={`${id}-enabled-hint`}
              className="mt-0.5 text-label text-muted-foreground"
            >
              {enabled
                ? "Each day follows its session. Free on every plan."
                : "Off: every day keeps the same target."}
            </p>
          </div>
          <Switch
            id={`${id}-enabled`}
            aria-describedby={`${id}-enabled-hint`}
            checked={enabled}
            onCheckedChange={toggle}
          />
        </CardBody>
      </Card>

      {enabled && schedule && week && (
        <EnabledEditor
          profile={profile}
          schedule={schedule}
          week={week}
          today={today}
          kcal={kcal}
          onEdit={setEditing}
          onTrainingChange={onTrainingChange}
          onProteinSettingChange={onProteinSettingChange}
          onOpenMeasurements={onOpenMeasurements}
        />
      )}

      {editing !== null && schedule && (
        <TrainingDayDialog
          key={editing}
          weekday={editing}
          day={schedule.days[editing] ?? { type: "rest" }}
          plannedKcal={(day) =>
            planWeek({
              ...profile,
              training: withTrainingDay(profile.training, editing, day),
            })?.days[weekIndex(editing)]?.targetCalories ?? null
          }
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSave={(day) => {
            haptic("success");
            onTrainingChange(withTrainingDay(profile.training, editing, day));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EnabledEditor({
  profile,
  schedule,
  week,
  today,
  kcal,
  onEdit,
  onTrainingChange,
  onProteinSettingChange,
  onOpenMeasurements,
}: {
  profile: PersonalInfo;
  schedule: TrainingSchedule;
  week: WeekTargets;
  today: string;
  kcal: (n: number) => string;
  onEdit: (weekday: number) => void;
  onTrainingChange: Props["onTrainingChange"];
  onProteinSettingChange: Props["onProteinSettingChange"];
  onOpenMeasurements: () => void;
}) {
  const id = useId();
  // Today's plan sets the week-level figures (the average, the floor,
  // protein, the notes): they can step mid-week (a birthday, a goal phase
  // starting), and today's are the ones in effect.
  const current = week.days.find((d) => d.date === today) ?? week.days[0];
  const training = current?.training;
  const mean = training?.meanCalories ?? current?.targetCalories ?? 0;
  const floor = Math.max(current?.bmr ?? 0, MIN_DAILY_KCAL);
  const fatMoves = fatMovesForDiet(profile.dietType);
  const setting = normalizeProteinSetting(profile.proteinSetting);
  const spread = weekSpread(schedule.cycling, week.days, current, floor);

  const chartDays = MONDAY_FIRST.map((weekday) => {
    const target = week.days[weekIndex(weekday)];
    return {
      weekday,
      short: WEEKDAY_SHORT[weekday],
      name: WEEKDAY_NAME[weekday],
      kcal: target?.targetCalories ?? mean,
      training: schedule.days[weekday]?.type !== "rest",
      today: target?.date === today,
    };
  });

  return (
    <>
      <Card asChild>
        <section aria-labelledby={`${id}-calories`}>
          <CardBody className="space-y-4">
            <h3
              id={`${id}-calories`}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              <span className="font-mono text-3xl font-medium tabular-nums tracking-tight text-foreground">
                {kcal(mean)}
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                kcal daily average
              </span>
            </h3>
            <TrainingWeekChart
              days={chartDays}
              mean={mean}
              floor={floor}
            />
            <div className="space-y-2">
              <p
                id={`${id}-cycling`}
                className="text-label font-medium text-foreground"
              >
                Day-to-day difference
              </p>
              <SegmentedControl
                aria-labelledby={`${id}-cycling`}
                value={schedule.cycling}
                onValueChange={(cycling) => {
                  haptic("select");
                  onTrainingChange(
                    withTrainingCycling(profile.training, cycling),
                  );
                }}
                options={CYCLING_PRESETS.map((c) => ({
                  value: c,
                  label: CYCLING_LABEL[c],
                }))}
              />
              <div aria-live="polite">
                <SpreadLine
                  spread={spread}
                  goal={current?.goal ?? profile.goal}
                />
              </div>
            </div>
            <p className="flex items-start gap-2 text-label text-muted-foreground">
              <ShieldCheck
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                Every day stays at or above your safety floor (
                <span className="font-mono tabular-nums">{kcal(floor)}</span>{" "}
                kcal).
              </span>
            </p>
          </CardBody>
        </section>
      </Card>

      <Card asChild>
        <section aria-labelledby={`${id}-days`}>
          <h3
            id={`${id}-days`}
            className="sr-only"
          >
            Weekly template
          </h3>
          <ul className="divide-y divide-border/60">
            {MONDAY_FIRST.map((weekday) => {
              const day = schedule.days[weekday] ?? { type: "rest" };
              const target = week.days[weekIndex(weekday)];
              const isToday = target?.date === today;
              return (
                <li key={weekday}>
                  <DayRow
                    weekday={weekday}
                    day={day}
                    isToday={isToday}
                    plannedKcal={target ? kcal(target.targetCalories) : "—"}
                    movingGrams={
                      target
                        ? `${kcal(fatMoves ? target.fat : target.carbs)} g ${fatMoves ? "fat" : "carbs"}`
                        : ""
                    }
                    onEdit={() => onEdit(weekday)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      </Card>

      <ProteinCard
        setting={setting}
        proteinGrams={current?.protein ?? 0}
        requestedGrams={training?.requestedProtein ?? current?.protein ?? 0}
        sameEveryDay={spread.kind !== "moves"}
        heldGrams={fatMoves ? (current?.carbs ?? 0) : (current?.fat ?? 0)}
        fatMoves={fatMoves}
        fatFloorLifted={training?.fatFloorLifted === true}
        kcal={kcal}
        onChange={(next) => {
          haptic("select");
          onProteinSettingChange(
            withProteinSetting(profile.proteinSetting, next),
          );
        }}
      />

      {training?.bodyFatWouldChangeProtein && (
        <BodyFatNote
          setting={setting}
          proteinBasis={training.proteinBasis}
          onOpenMeasurements={onOpenMeasurements}
        />
      )}
    </>
  );
}

function DayRow({
  weekday,
  day,
  isToday,
  plannedKcal,
  movingGrams,
  onEdit,
}: {
  weekday: number;
  day: TrainingDay;
  isToday: boolean;
  plannedKcal: string;
  movingGrams: string;
  onEdit: () => void;
}) {
  const rest = day.type === "rest";
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-current={isToday ? "date" : undefined}
      className="flex min-h-touch-10 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
    >
      <span className="w-12 shrink-0">
        <span className="sr-only">Edit {WEEKDAY_NAME[weekday]}</span>
        <span
          aria-hidden
          className={cn(
            "block text-sm font-medium",
            isToday ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {WEEKDAY_SHORT[weekday]}
        </span>
        {isToday && (
          <span className="block text-label font-medium text-signal">
            Today
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-label font-medium",
            rest
              ? "bg-background text-muted-foreground ring-1 ring-inset ring-border"
              : "bg-brand/12 text-brand-text",
          )}
        >
          {TRAINING_TYPE_LABEL[day.type]}
        </span>
        <span className="mt-1 block text-label text-muted-foreground">
          {sessionDetails(day)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-base font-medium tabular-nums text-foreground">
          {plannedKcal}
          <span className="sr-only"> kcal planned</span>
        </span>
        <span className="block text-label tabular-nums text-muted-foreground">
          {movingGrams}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

function ProteinCard({
  setting,
  proteinGrams,
  requestedGrams,
  sameEveryDay,
  heldGrams,
  fatMoves,
  fatFloorLifted,
  kcal,
  onChange,
}: {
  setting: ProteinSetting;
  /** The planned daily protein (today's day; the same all week). */
  proteinGrams: number;
  /** What the setting asks for (`training.requestedProtein`): above
   *  `proteinGrams` only when the floors made protein give way. */
  requestedGrams: number;
  /** Every day plans the same calories (cycling off, or the days can't
   *  vary), so no macro moves between them. */
  sameEveryDay: boolean;
  /** The macro held for the whole week: carbs when fat moves with each
   *  day's calories (`fatMovesForDiet`), else fat. */
  heldGrams: number;
  fatMoves: boolean;
  /** `DateTargets.training.fatFloorLifted`: the fat floor changed the
   *  user's explicit fat choice. */
  fatFloorLifted: boolean;
  kcal: (n: number) => string;
  onChange: (next: ProteinSetting) => void;
}) {
  const id = useId();
  const locale = useLocale();
  const max = PROTEIN_G_PER_KG_MAX[setting.basis];
  const atMin = setting.gPerKg <= PROTEIN_G_PER_KG_MIN;
  const atMax = setting.gPerKg >= max;
  const step = (dir: 1 | -1) => {
    // At a bound the button stays focusable (`aria-disabled`, not
    // `disabled`, which would drop keyboard focus to <body>) and does
    // nothing.
    if (dir === 1 ? atMax : atMin) return;
    onChange({
      ...setting,
      gPerKg: Math.round((setting.gPerKg + dir * PROTEIN_STEP) * 10) / 10,
    });
  };
  return (
    <Card asChild>
      <section aria-labelledby={`${id}-protein`}>
        <CardBody className="space-y-4">
          <h3
            id={`${id}-protein`}
            className="text-sm font-semibold text-foreground"
          >
            Protein:{" "}
            <span className="font-mono tabular-nums">{kcal(proteinGrams)}</span>{" "}
            g every day
          </h3>
          <div className="space-y-2">
            <p
              id={`${id}-basis`}
              className="text-label font-medium text-foreground"
            >
              Based on
            </p>
            <SegmentedControl
              aria-labelledby={`${id}-basis`}
              value={setting.basis}
              onValueChange={(basis) =>
                onChange({
                  basis,
                  gPerKg: Math.min(setting.gPerKg, PROTEIN_G_PER_KG_MAX[basis]),
                })
              }
              options={[
                { value: "bodyweight", label: "Bodyweight" },
                { value: "leanMass", label: "Lean mass" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p
              id={`${id}-gkg`}
              className="text-label font-medium text-foreground"
            >
              Grams per kg
            </p>
            <div
              role="group"
              aria-labelledby={`${id}-gkg`}
              className="flex items-center gap-2"
            >
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Less protein"
                aria-disabled={atMin}
                className={STEPPER_BOUND}
                onClick={() => step(-1)}
              >
                <Minus aria-hidden />
              </Button>
              <output
                aria-live="polite"
                className="w-20 text-center font-mono text-base font-medium tabular-nums text-foreground"
              >
                {formatNumber(setting.gPerKg, locale, 1)} g/kg
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="More protein"
                aria-disabled={atMax}
                className={STEPPER_BOUND}
                onClick={() => step(1)}
              >
                <Plus aria-hidden />
              </Button>
            </div>
          </div>
          <p className="text-label text-muted-foreground">
            {formatNumber(PROTEIN_G_PER_KG_MIN, locale, 1)} to{" "}
            {formatNumber(max, locale, 1)} g/kg.{" "}
            {proteinGrams < requestedGrams
              ? `Protein is planned at ${kcal(proteinGrams)} g a day for now, under the ${kcal(requestedGrams)} g your setting asks for, so the fat and carb minimums fit.`
              : sameEveryDay
                ? "Every day plans the same protein, carbs and fat."
                : fatMoves
                  ? `Fat moves with each day's calories; carbs stay near ${kcal(heldGrams)} g and protein stays the same.`
                  : `Carbs move with each day's calories; fat stays near ${kcal(heldGrams)} g and protein stays the same.`}
          </p>
          {fatFloorLifted && (
            <Callout tone="info">
              {fatMoves ? (
                <>
                  Carbs stay at{" "}
                  <span className="font-mono tabular-nums">
                    {kcal(heldGrams)}
                  </span>{" "}
                  g a day while you train, a little under your chosen split, so
                  fat sits a little higher each day to keep a healthy minimum.
                </>
              ) : (
                <>
                  Fat stays at{" "}
                  <span className="font-mono tabular-nums">
                    {kcal(heldGrams)}
                  </span>{" "}
                  g a day while you train, a little above your chosen split, to
                  keep a healthy minimum.
                </>
              )}
            </Callout>
          )}
        </CardBody>
      </section>
    </Card>
  );
}

/** The line under the cycling control: what the choice does to this week,
 *  or, when the days can't vary, why (calm, one sentence or two). */
function SpreadLine({
  spread,
  goal,
}: {
  spread: WeekSpread;
  goal: PersonalInfo["goal"];
}) {
  if (spread.kind === "moves" || spread.kind === "off") {
    return (
      <p className="text-label text-muted-foreground">
        {spread.kind === "off"
          ? "Every day stays at your weekly average."
          : "Calories move between days; your weekly average stays the same."}
      </p>
    );
  }
  let copy: string;
  switch (spread.kind) {
    case "floors": {
      const held = spread.proteinHeld
        ? " and protein is held under your setting for now"
        : "";
      copy =
        spread.cause === "protein"
          ? `Your protein setting leaves little room for the other minimums at this calorie level, so every day stays at the average${held}. A lower g/kg setting would let the days vary.`
          : `Your calorie target leaves little room for the protein, fat and carb minimums together, so every day stays at the average${held}.${goal === "lose" ? " A smaller deficit would give each day more room." : ""}`;
      break;
    }
    case "sameDays":
      copy =
        "Every day of your week plans the same way, so each stays at your weekly average. Days with different sessions would vary.";
      break;
    case "atFloor":
      copy =
        "Your average is already close to your safety floor, so every day stays at the average for now.";
      break;
    case "atMinimums":
      copy =
        "Your average is already close to the smallest day that fits your protein, fat and carb minimums, so every day stays at the average for now.";
      break;
  }
  return <Callout className="text-label leading-5">{copy}</Callout>;
}

/** A body-fat estimate would change protein: why, and where it comes from. */
function BodyFatNote({
  setting,
  proteinBasis,
  onOpenMeasurements,
}: {
  setting: ProteinSetting;
  proteinBasis: "bodyweight" | "leanMass" | "referenceWeight";
  onOpenMeasurements: () => void;
}) {
  const copy =
    setting.basis === "leanMass"
      ? `Lean mass needs a body-fat estimate. Until there is one, protein uses up to 2.0 g/kg of ${proteinBasis === "referenceWeight" ? "a reference weight for your height" : "your bodyweight"}.`
      : "Protein is set from a reference weight for your height. A body-fat estimate would make it more precise.";
  return (
    <Callout tone="info">
      <p>{copy}</p>
      <Button
        type="button"
        variant="link"
        className="h-auto min-h-touch-7 px-0 text-brand-text"
        onClick={onOpenMeasurements}
      >
        Open My measurements
      </Button>
    </Callout>
  );
}
