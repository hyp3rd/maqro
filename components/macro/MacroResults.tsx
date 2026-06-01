"use client";

import { NumberTicker } from "@/components/shell/NumberTicker";
import { kgToDisplay, type UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";
import * as React from "react";
import { CalculatedValues, TotalMacros } from "../../components/macro/types";
import { InfoExplainer } from "./InfoExplainer";

interface MacroResultsProps {
  calculatedValues: CalculatedValues;
  totalMacros: TotalMacros;
  /** User's preferred display units. The deficit-rate line at the
   *  bottom of the headline grid renders "kg/wk" or "lb/wk" based
   *  on this; the headline numbers themselves stay in kcal (a
   *  universal unit). */
  units: UnitSystem;
}

type MacroKey = "protein" | "carbs" | "fat";

const MACRO_META: Record<
  MacroKey,
  { label: string; kcalPerGram: number; cssVar: string }
> = {
  protein: { label: "Protein", kcalPerGram: 4, cssVar: "--macro-protein" },
  carbs: { label: "Carbs", kcalPerGram: 4, cssVar: "--macro-carbs" },
  fat: { label: "Fat", kcalPerGram: 9, cssVar: "--macro-fat" },
};

/** Per-stat explainer content for the headline grid. Lives at
 *  module scope so the JSX bodies don't get recreated on every
 *  render. Beta testers asked the same three questions over and
 *  over - having the answer one tap away from each number is the
 *  cheapest possible documentation. */
const HEADLINE_STATS: ReadonlyArray<{
  label: "BMR" | "TDEE" | "Target";
  explainerTitle: string;
  explainer: React.ReactNode;
}> = [
  {
    label: "BMR",
    explainerTitle: "What is BMR?",
    explainer: (
      <>
        <p>
          <strong>Basal Metabolic Rate</strong> is the energy your body burns at
          complete rest - the cost of keeping you alive: breathing, circulation,
          organ function, brain activity. No exercise, no digestion, no daily
          activity included.
        </p>
        <p>
          We compute it with the <strong>Mifflin–St Jeor</strong> equation, the
          textbook formula nutritionists use:
        </p>
        <pre className="rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {`Men:   10 × kg + 6.25 × cm − 5 × age + 5
Women: 10 × kg + 6.25 × cm − 5 × age − 161`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Caveat: formula-based BMR is accurate <em>on average</em> but can be
          off by 10–20% for any individual. Things like muscle mass, recent
          dieting, thyroid status, and ancestry shift the real number. The
          manual TDEE override below lets you calibrate against your own
          observed weight change once you have a few weeks of data.
        </p>
      </>
    ),
  },
  {
    label: "TDEE",
    explainerTitle: "What is TDEE?",
    explainer: (
      <>
        <p>
          <strong>Total Daily Energy Expenditure</strong> is how many calories
          you actually burn in a typical day. It&apos;s your BMR multiplied by
          an <em>activity multiplier</em> that accounts for movement, exercise,
          and digestion:
        </p>
        <pre className="rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {`TDEE = BMR × activity multiplier

Sedentary    × 1.2   (desk job, no exercise)
Light        × 1.375 (1–3 workouts / week)
Moderate     × 1.55  (3–5 workouts / week)
Active       × 1.725 (6–7 workouts / week)
Very active  × 1.9   (daily training + physical job)`}
        </pre>
        <p className="text-xs text-muted-foreground">
          The single biggest source of TDEE error is{" "}
          <strong>overestimating your own activity level</strong>. Most office
          workers who think they&apos;re &ldquo;Moderate&rdquo; are actually
          Sedentary-with-occasional-workouts. If you eat at your computed TDEE
          for a month and still gain weight, drop one level and reassess -
          formulas are a starting point, not the truth.
        </p>
        <p className="text-xs text-muted-foreground">
          Tip: after 2–3 weeks of consistent logging, the Progress tab can
          suggest a calibrated TDEE based on your real-world weight change.
          Override the formula estimate in <em>Calculator → Manual TDEE</em> to
          use it.
        </p>
      </>
    ),
  },
  {
    label: "Target",
    explainerTitle: "What is Target?",
    explainer: (
      <>
        <p>
          <strong>Target calories</strong> is what you should aim to eat per day
          to hit your weight-change goal:
        </p>
        <pre className="rounded-md bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {`Target = TDEE + (goal direction × weekly rate × 7700 / 7)

  goal direction:  −1 (lose), 0 (maintain), +1 (gain)
  7700 kcal/kg:    energy density of body fat
  ÷7 spreads the weekly change across each day`}
        </pre>
        <p className="text-xs text-muted-foreground">
          A 0.5 kg/week loss = a ~550 kcal/day deficit. A 0.25 kg/week gain = a
          ~275 kcal/day surplus.
        </p>
        <p className="text-xs text-muted-foreground">
          When your goal requires a deeper deficit than is safe, the app caps
          the target and shows an amber &ldquo;Capped to safety floor&rdquo;
          notice below. Tap the (i) on that notice for the full explanation and
          what to do about it.
        </p>
      </>
    ),
  },
];

/** Explainer body for the amber "Capped to safety floor" notice
 *  below the headline grid. Lives at module scope so the JSX
 *  isn't rebuilt on every render. The copy is the answer to the
 *  most common follow-up question from beta testers: "why doesn't
 *  my goal rate match my target rate?" */
const SAFETY_FLOOR_EXPLAINER = (
  <>
    <p>
      Your goal calls for a deeper deficit than is safe to recommend, so we
      clamp the daily target to{" "}
      <code className="font-mono">max(BMR, 1200 kcal)</code> — eating below your
      own BMR isn&apos;t a faster shortcut to fat loss; it tends to slow your
      metabolism, increase hunger, and stall progress within a few weeks.
    </p>
    <p>
      This is also why your displayed weekly rate may not match what you set on
      the Calculator tab — the cap moved the actual deficit up to the floor.
    </p>
    <p className="text-xs text-muted-foreground">
      Three ways to bring goal and actual back into alignment:
    </p>
    <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
      <li>
        <strong>Pick a slower weekly rate&nbsp;</strong> on the Calculator tab.
        Slower fat loss is also more sustainable — most people lose long- term
        faster at 0.5%/week than at 1%/week.
      </li>
      <li>
        <strong>Raise your activity level&nbsp;</strong> if it&apos;s realistic.
        A higher activity multiplier means a higher TDEE, which gives the same
        deficit more room before it hits the floor. Be honest, though —
        overstating activity is the #1 reason calculators look wrong.
      </li>
      <li>
        <strong>Calibrate your TDEE&nbsp;</strong> from real data once you have
        2–3 weeks of weigh-ins (the Progress tab will suggest a number). If your
        real TDEE is higher than the formula thinks, the deficit fits within the
        floor.
      </li>
    </ul>
  </>
);

const MacroResults: React.FC<MacroResultsProps> = ({
  calculatedValues,
  totalMacros,
  units,
}) => {
  const pct = (current: number, target: number) =>
    target === 0 ? 0 : Math.min(Math.round((current / target) * 100), 100);

  return (
    <div className="space-y-6">
      {/* Headline numbers */}
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="border-b border-border/60 px-5 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Daily Targets
          </p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border/60">
          {HEADLINE_STATS.map((s) => (
            <div
              key={s.label}
              className="px-5 py-4"
            >
              {/* Label + (i) explainer - the same questions kept
               *  coming in from beta testers ("what is BMR?",
               *  "why is my TDEE so high?"), so the explanations
               *  live one tap away from the numbers they describe.
               *  See InfoExplainer.tsx for the dialog rationale. */}
              <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {s.label}
                <InfoExplainer
                  title={s.explainerTitle}
                  ariaLabel={`More information about ${s.label}`}
                >
                  {s.explainer}
                </InfoExplainer>
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
                <NumberTicker
                  value={
                    s.label === "BMR"
                      ? calculatedValues.bmr
                      : s.label === "TDEE"
                        ? calculatedValues.tdee
                        : calculatedValues.targetCalories
                  }
                  suffix=""
                />
              </p>
              <p className="text-[11px] text-muted-foreground">kcal/day</p>
            </div>
          ))}
        </div>
        {calculatedValues.dailyDelta !== 0 && (
          <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
            <span className="text-xs text-muted-foreground">
              {calculatedValues.dailyDelta < 0 ? "Deficit" : "Surplus"}
            </span>
            <span
              className={cn(
                "font-mono text-sm font-medium tabular-nums",
                calculatedValues.dailyDelta < 0
                  ? "text-foreground"
                  : "text-foreground",
              )}
            >
              <NumberTicker
                value={calculatedValues.dailyDelta}
                prefix={calculatedValues.dailyDelta > 0 ? "+" : ""}
                suffix=" kcal"
              />
              <span className="ml-2 text-muted-foreground">
                ≈{" "}
                {kgToDisplay(
                  (Math.abs(calculatedValues.dailyDelta) * 7) / 7700,
                  units,
                ).toFixed(2)}{" "}
                {units === "imperial" ? "lb" : "kg"}/wk
              </span>
            </span>
          </div>
        )}
        {calculatedValues.dailyDelta !== calculatedValues.requestedDelta && (
          <div className="flex items-start gap-1.5 border-t border-border/60 bg-amber-500/5 px-5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <span className="flex-1">
              Capped to safety floor (max(BMR, 1200 kcal)). Your displayed
              weekly rate is the capped one, not the rate you set on the
              Calculator tab.
            </span>
            <InfoExplainer
              title="Why the cap?"
              ariaLabel="Why is my target capped to the safety floor?"
            >
              {SAFETY_FLOOR_EXPLAINER}
            </InfoExplainer>
          </div>
        )}
      </section>

      {/* Macro breakdown */}
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="border-b border-border/60 px-5 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Macro Targets
          </p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border/60">
          {(["protein", "carbs", "fat"] as MacroKey[]).map((k) => {
            const meta = MACRO_META[k];
            const grams = calculatedValues[k];
            return (
              <div
                key={k}
                className="px-5 py-4"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: `hsl(var(${meta.cssVar}))` }}
                    aria-hidden
                  />
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {meta.label}
                  </p>
                </div>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
                  <NumberTicker
                    value={grams}
                    suffix="g"
                  />
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {grams * meta.kcalPerGram} kcal
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Progress */}
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="border-b border-border/60 px-5 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Today
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          {(["protein", "carbs", "fat"] as MacroKey[]).map((k) => {
            const meta = MACRO_META[k];
            const current = totalMacros[k];
            const target = calculatedValues[k];
            const p = pct(current, target);
            return (
              <ProgressRow
                key={k}
                label={meta.label}
                cssVar={meta.cssVar}
                current={current}
                target={target}
                pct={p}
                unit="g"
              />
            );
          })}
          <ProgressRow
            label="Calories"
            cssVar=""
            current={totalMacros.calories}
            target={calculatedValues.targetCalories}
            pct={pct(totalMacros.calories, calculatedValues.targetCalories)}
            unit=""
          />
        </div>
      </section>

      {calculatedValues.dailyDelta !== 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Assumes ~7700 kcal/kg of bodyweight change. If your real-world rate
          diverges by more than ~20% after a few weeks, override TDEE in the
          form to recalibrate.
        </p>
      )}
    </div>
  );
};

function ProgressRow({
  label,
  cssVar,
  current,
  target,
  pct,
  unit,
}: {
  label: string;
  cssVar: string;
  current: number;
  target: number;
  pct: number;
  unit: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          {cssVar ? (
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `hsl(var(${cssVar}))` }}
              aria-hidden
            />
          ) : null}
          <span className="text-xs font-medium text-foreground">{label}</span>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {current}
          {unit} / {target}
          {unit}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: cssVar
              ? `hsl(var(${cssVar}))`
              : "hsl(var(--foreground))",
          }}
        />
      </div>
    </div>
  );
}

export default MacroResults;
