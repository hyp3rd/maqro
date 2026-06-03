"use client";

import { MicronutrientsSection } from "@/components/macro/MicronutrientsSection";
import { ChartZoomDialog } from "@/components/shell/ChartZoomDialog";
import {
  MiniLineChart,
  type LinePoint,
} from "@/components/shell/MiniLineChart";
import { NumberTicker } from "@/components/shell/NumberTicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToday } from "@/hooks/use-today";
import { bodyFatCategory, estimateBodyFat } from "@/lib/body-fat";
import {
  listBodyMeasurements,
  listDailyLogs,
  listWaterIntake,
  listWeightEntries,
  saveBodyMeasurement,
  saveWeightEntry,
  todayKey,
  type BodyMeasurement,
  type DailyLog,
  type WaterIntake,
  type WeightEntry,
} from "@/lib/db";
import { reportStorageError, reportStorageOk } from "@/lib/storage-status";
import { computeStreak, type StreakState } from "@/lib/streaks";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import {
  ADAPTIVE_DELTA_THRESHOLD,
  confidenceLabel,
  detectPlateau,
  inferAdaptiveTdee,
  recalibrateTdee,
  type AdaptiveTdee,
  type PlateauState,
  type TdeeRecalibration,
} from "@/lib/trends";
import {
  cmToInches,
  displayToKg,
  displayToMl,
  formatVolume,
  inchesToCm,
  kgToDisplay,
  mlToDisplay,
  volumeUnitSuffix,
} from "@/lib/units";
import { cn } from "@/lib/utils";
import { computeWeeklyRecap, type WeeklyRecap } from "@/lib/weekly-recap";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Droplets,
  FileDown,
  Flame,
  LineChart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { ExportReportDialog } from "./ExportReportDialog";

const WINDOW_DAYS = 60;

type Props = {
  /** Today's calorie target - drawn as a reference line on the calorie
   * chart. We use the *current* profile's target for all historical days;
   * the chart is honest about adherence relative to where you stand now,
   * not where you stood then. A target-history store is the proper fix
   * for cuts/bulks; flagged as a follow-up. */
  targetCalories: number;
  /** Formula TDEE (before goal adjustment) - feeds the recalibration
   *  helper. Drawn from `calculatedValues.tdee` on the calling side. */
  formulaTdee: number;
  /** Intended daily calorie delta vs. TDEE (negative = cut,
   *  positive = bulk, 0 = maintain). Read from
   *  `calculatedValues.dailyDelta`. */
  dailyDelta: number;
  /** Goal label - drives the plateau advisory's wording. */
  goal: "lose" | "maintain" | "gain";
  /** Gender from the profile - used to pick the body-fat formula
   *  for the Body card. `nonbinary` / `preferNotToSay` disables
   *  the automatic estimate (no published Navy formula for those);
   *  the user can still log raw measurements. */
  gender: "male" | "female" | "nonbinary" | "preferNotToSay";
  /** Height in cm - input to the body-fat formula. */
  heightCm: number;
  /** User's preferred display units. Drives unit-aware rendering
   *  across every surface here: weight chart axis + headline
   *  (kg ↔ lb), trend recaps, weigh-in form input, and body-
   *  measurement card + form (cm ↔ in). Storage stays metric
   *  everywhere; conversion happens at the UI boundary only. */
  units: "metric" | "imperial";
  /** Apply an observed-maintenance estimate as the manual TDEE override
   *  — closes the adaptive-TDEE loop in one tap (writes `manualTdee` on
   *  the profile, which re-derives every target). */
  onApplyTdee: (tdee: number) => void;
  /** Effective daily water goal (ml) — already resolved from the override
   *  or the weight-based default by the caller. Drawn as the reference line
   *  on the hydration chart. */
  waterGoalMl: number;
  /** The raw manual override (ml) if the user set one, else null/undefined
   *  ("auto"). Distinguishes "auto-derived" from an explicit target in the
   *  goal editor. */
  waterGoalOverride: number | null | undefined;
  /** Persist a manual water-goal override (ml), or `null` to revert to the
   *  weight-based default. */
  onSetWaterGoal: (ml: number | null) => void;
};

function parseLocalDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function dayIndex(d: string): number {
  return Math.floor(parseLocalDate(d).getTime() / 86_400_000);
}

function shortLabel(d: string): string {
  return parseLocalDate(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ProgressView({
  targetCalories,
  formulaTdee,
  dailyDelta,
  goal,
  gender,
  heightCm,
  units,
  onApplyTdee,
  waterGoalMl,
  waterGoalOverride,
  onSetWaterGoal,
}: Props) {
  const [weights, setWeights] = useState<WeightEntry[] | null>(null);
  const [logs, setLogs] = useState<DailyLog[] | null>(null);
  const [measurements, setMeasurements] = useState<BodyMeasurement[] | null>(
    null,
  );
  const [water, setWater] = useState<WaterIntake[] | null>(null);
  const [rev, setRev] = useState(0);
  // Refresh when a peer device writes a weight entry or a daily log
  // (both of which feed the charts here). Each bus has its own rev
  // counter; both feed into the same load effect.
  const weightRev = useDataRev("weightHistory");
  const dailyLogsRev = useDataRev("dailyLogs");
  const bodyMeasurementsRev = useDataRev("bodyMeasurements");
  const waterRev = useDataRev("waterIntake");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listWeightEntries(),
      listDailyLogs(),
      listBodyMeasurements(),
      listWaterIntake(),
    ])
      .then(([w, l, m, water]) => {
        if (cancelled) return;
        setMeasurements(m);
        setWeights(w);
        setLogs(l);
        setWater(water);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStorageError(err);
        setWeights([]);
        setLogs([]);
        setMeasurements([]);
        setWater([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rev, weightRev, dailyLogsRev, bodyMeasurementsRev, waterRev]);

  const refresh = () => setRev((r) => r + 1);

  // Engagement summaries - both are pure derivations that need
  // logs + weights + today. We re-compute on every data load (cheap
  // for our scale; the helpers run in microseconds even on a year of
  // history). `today` from `todayKey()` keeps the calc in sync with
  // the user's local-date conventions used everywhere else.
  const today = todayKey();
  const streak = useMemo<StreakState>(
    () => computeStreak(logs ?? [], today),
    [logs, today],
  );
  const recap = useMemo<WeeklyRecap>(
    () => computeWeeklyRecap(logs ?? [], weights ?? [], targetCalories, today),
    [logs, weights, targetCalories, today],
  );
  // Trend derivations - both pure, both run on the same `weights`
  // array as the chart so the numbers stay consistent with what
  // the user sees plotted. Recomputed on every load (cheap; the
  // helpers are O(n) over typical 60-point ranges).
  const plateau = useMemo<PlateauState>(
    () => detectPlateau(weights ?? [], goal),
    [weights, goal],
  );
  const tdeeReco = useMemo<TdeeRecalibration>(
    () => recalibrateTdee({ weights: weights ?? [], formulaTdee, dailyDelta }),
    [weights, formulaTdee, dailyDelta],
  );
  // Adaptive (dynamic) TDEE — maintenance inferred from logged intake vs.
  // the weight trend. Primary over `tdeeReco`; that one stays as the
  // fallback for users who weigh in but don't log food (no intake series).
  const adaptive = useMemo<AdaptiveTdee>(() => {
    const intake = (logs ?? [])
      .filter((l) => l.date <= today)
      .map((l) => ({
        date: l.date,
        calories: l.meals.reduce(
          (s, m) => s + m.foods.reduce((ms, f) => ms + f.calories, 0),
          0,
        ),
      }));
    return inferAdaptiveTdee({ weights: weights ?? [], intake });
  }, [weights, logs, today]);

  return (
    <div className="space-y-6">
      {/* Export entry point. Opens a pre-flight dialog → routes
       *  to /report (a dedicated print-optimised page) on confirm.
       *  The live ProgressView is no longer the print target, so
       *  the old print-only header + @media print rules don't
       *  apply here — see /report for the printable layout. */}
      <div className="flex justify-end">
        <ProgressExportButton />
      </div>

      <EngagementSection
        streak={streak}
        recap={recap}
        targetCalories={targetCalories}
        loading={logs === null || weights === null}
        units={units}
      />
      <TrendsSection
        plateau={plateau}
        adaptive={adaptive}
        tdeeReco={tdeeReco}
        currentTdee={formulaTdee}
        onApplyTdee={onApplyTdee}
        loading={weights === null}
        units={units}
      />
      <WeightSection
        entries={weights}
        targetWindow={WINDOW_DAYS}
        units={units}
      />
      <WeighInForm
        onSaved={refresh}
        units={units}
      />
      <BodyMeasurementsSection
        entries={measurements}
        gender={gender}
        heightCm={heightCm}
        targetWindow={WINDOW_DAYS}
        units={units}
        onSaved={refresh}
      />
      <CalorieSection
        logs={logs}
        targetCalories={targetCalories}
        targetWindow={WINDOW_DAYS}
      />
      <HydrationSection
        entries={water}
        goalMl={waterGoalMl}
        override={waterGoalOverride}
        units={units}
        targetWindow={WINDOW_DAYS}
        onSetGoal={onSetWaterGoal}
      />
      <MicronutrientsSection
        logs={logs}
        windowDays={WINDOW_DAYS}
      />
    </div>
  );
}

/** Export-as-PDF entry point. Opens a pre-flight dialog where the
 *  user picks date range + sections + an optional title and cover
 *  note; submitting routes to a dedicated `/report` page that's
 *  built for printing (no app chrome, no form inputs, single-
 *  column flow, proper page-break hints). The print dialog only
 *  fires from the report page's own "Save as PDF" button, so the
 *  user sees the print preview once — for the report they
 *  actually configured.
 *
 *  Prior version called `window.print()` directly on the live
 *  view, which produced a poor PDF: the Log weigh-in / body-
 *  measurement form fields landed in the document, the layout
 *  broke across pages mid-section, and the user had no way to
 *  scope to a date range. */
function ProgressExportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileDown className="h-3.5 w-3.5" />
        Export PDF
      </button>
      <ExportReportDialog
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

/** Top-of-view engagement summary: current streak (with longest as
 *  context) + last-7-days recap. Two cards in one row on desktop,
 *  stacked on mobile. Skips render entirely while data is loading
 *  so it doesn't flash "streak: 0" before the IDB pull lands. */
/** Renders the two derived-from-weight cards: plateau detector +
 *  TDEE recalibration suggestion. Both are silent when there's no
 *  signal - a card with "no advisory" or "not enough data" is
 *  noise. Whole section hides when there's nothing to say AND
 *  isn't loading (avoids the "empty section ghost" pattern). */
function TrendsSection({
  plateau,
  adaptive,
  tdeeReco,
  currentTdee,
  onApplyTdee,
  loading,
  units,
}: {
  plateau: PlateauState;
  adaptive: AdaptiveTdee;
  tdeeReco: TdeeRecalibration;
  /** The TDEE the targets are currently derived from (manual override
   *  if set, else the formula) — the baseline the adaptive estimate is
   *  compared against. */
  currentTdee: number;
  onApplyTdee: (tdee: number) => void;
  loading: boolean;
  units: "metric" | "imperial";
}) {
  if (loading) return null;

  const observed = adaptive.observedTdee;
  // Adaptive is primary: show it once we have an estimate that's a
  // meaningful distance from where the targets currently sit. Otherwise
  // fall back to the weights-only recalibration advisory (covers users
  // who weigh in but don't log their food).
  const showAdaptive =
    observed !== null &&
    Math.abs(observed - currentTdee) >= ADAPTIVE_DELTA_THRESHOLD;
  const showRecalibration = !showAdaptive && Boolean(tdeeReco.advisory);

  // Nothing actionable anywhere → don't render. The EngagementSection
  // above already shows "you logged X of 7"; an empty Trends card here
  // would just be visual debt.
  if (!plateau.advisory && !showAdaptive && !showRecalibration) return null;

  const unitLabel = units === "imperial" ? "lb" : "kg";

  return (
    <section className="space-y-3">
      {plateau.advisory && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-5 py-4">
          <header className="mb-1.5 flex items-center gap-2">
            <LineChart className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
            <h3 className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Plateau detected
            </h3>
          </header>
          <p className="text-sm leading-relaxed text-foreground">
            {plateau.advisory}
          </p>
          {plateau.startKg !== null && plateau.endKg !== null && (
            <p className="mt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              Smoothed weight: {kgToDisplay(plateau.startKg, units).toFixed(1)}{" "}
              → {kgToDisplay(plateau.endKg, units).toFixed(1)} {unitLabel} over{" "}
              {plateau.daysFlat} days
            </p>
          )}
        </div>
      )}

      {showAdaptive && observed !== null && (
        <div className="rounded-lg border border-border/60 bg-card px-5 py-4">
          <header className="mb-1.5 flex items-center gap-2">
            {observed > currentTdee ? (
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Adaptive TDEE
            </h3>
          </header>
          <p className="text-sm leading-relaxed text-foreground">
            Your last {adaptive.windowDays} days of logging put your maintenance
            near{" "}
            <span className="font-semibold tabular-nums">{observed} kcal</span>
            /day — about {Math.abs(observed - currentTdee)} kcal{" "}
            {observed > currentTdee ? "higher" : "lower"} than the{" "}
            {currentTdee.toLocaleString()} kcal your targets use now. This is
            measured from what you actually logged, not the activity estimate.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              type="button"
              size="sm"
              onClick={() => onApplyTdee(observed)}
              className="h-8 gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Use {observed} kcal as my TDEE
            </Button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {adaptive.loggedDays} logged days
              {adaptive.weightSlopeKgPerWeek !== null && (
                <>
                  {" "}
                  · trend {adaptive.weightSlopeKgPerWeek > 0 ? "+" : ""}
                  {kgToDisplay(adaptive.weightSlopeKgPerWeek, units).toFixed(
                    2,
                  )}{" "}
                  {unitLabel}/wk
                </>
              )}
              {confidenceLabel(adaptive.confidence) &&
                ` · ${confidenceLabel(adaptive.confidence)}`}
            </span>
          </div>
        </div>
      )}

      {showRecalibration && (
        <div className="rounded-lg border border-border/60 bg-card px-5 py-4">
          <header className="mb-1.5 flex items-center gap-2">
            {tdeeReco.deltaKcalPerDay > 0 ? (
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              TDEE recalibration
            </h3>
          </header>
          <p className="text-sm leading-relaxed text-foreground">
            {tdeeReco.advisory}
          </p>
          <p className="mt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
            Based on {tdeeReco.windowDays} days of weigh-ins · actual change{" "}
            {tdeeReco.weightChangeKg > 0 ? "+" : ""}
            {kgToDisplay(tdeeReco.weightChangeKg, units).toFixed(2)} {unitLabel}{" "}
            · log your meals to get a measured estimate you can apply in one
            tap.
          </p>
        </div>
      )}
    </section>
  );
}

function EngagementSection({
  streak,
  recap,
  targetCalories,
  loading,
  units,
}: {
  streak: StreakState;
  recap: WeeklyRecap;
  targetCalories: number;
  loading: boolean;
  units: "metric" | "imperial";
}) {
  if (loading) return null;

  const adherencePct =
    recap.daysLogged > 0
      ? Math.round((recap.adherenceDays / recap.daysLogged) * 100)
      : 0;

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Streak - single-stat card with the longest run as a quiet
          companion line. Flame icon reuses the engagement-app
          convention so the affordance reads instantly. */}
      <div className="rounded-lg border border-border/60 bg-card px-5 py-4">
        <header className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Logging streak
          </h3>
          <Flame
            className={cn(
              "h-4 w-4",
              streak.current > 0
                ? "text-amber-500"
                : "text-muted-foreground/40",
            )}
          />
        </header>
        <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-foreground">
          {streak.current}
          <span className="ml-1 text-base font-normal text-muted-foreground">
            day{streak.current === 1 ? "" : "s"}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {streak.current === 0
            ? "Log a meal today to start a streak."
            : streak.current >= streak.longest
              ? "All-time best - keep going."
              : `Best: ${streak.longest} day${streak.longest === 1 ? "" : "s"}.`}
        </p>
      </div>

      {/* Days-logged + adherence - quick "did I show up this week"
          read. Adherence is the % of logged days where calories
          landed within ±10% of the current target. */}
      <div className="rounded-lg border border-border/60 bg-card px-5 py-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Last 7 days
        </h3>
        <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-foreground">
          {recap.daysLogged}
          <span className="ml-1 text-base font-normal text-muted-foreground">
            / 7 logged
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {recap.daysLogged === 0
            ? "Nothing logged yet this week."
            : targetCalories === 0
              ? `${recap.daysLogged} day${recap.daysLogged === 1 ? "" : "s"} logged.`
              : `${adherencePct}% of those within ±10% of ${targetCalories} kcal.`}
        </p>
      </div>

      {/* Average daily macros (over logged days). The classic
          "what does my real diet look like" answer that the bar
          charts below can't tell you in one number. */}
      <div className="rounded-lg border border-border/60 bg-card px-5 py-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Avg per logged day
        </h3>
        {recap.daysLogged === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Log to see your averages here.
          </p>
        ) : (
          <>
            <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-foreground">
              {Math.round(recap.avg.calories)}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                kcal
              </span>
            </p>
            <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              <span
                style={{ color: "hsl(var(--macro-protein))" }}
                aria-label={`${recap.avg.protein.toFixed(0)} grams of protein`}
              >
                P{recap.avg.protein.toFixed(0)}
              </span>{" "}
              ·{" "}
              <span
                style={{ color: "hsl(var(--macro-carbs))" }}
                aria-label={`${recap.avg.carbs.toFixed(0)} grams of carbs`}
              >
                C{recap.avg.carbs.toFixed(0)}
              </span>{" "}
              ·{" "}
              <span
                style={{ color: "hsl(var(--macro-fat))" }}
                aria-label={`${recap.avg.fat.toFixed(0)} grams of fat`}
              >
                F{recap.avg.fat.toFixed(0)}
              </span>
              {recap.weightDeltaKg !== null && (
                <>
                  {" · "}
                  <span
                    className={
                      recap.weightDeltaKg < 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : recap.weightDeltaKg > 0
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {recap.weightDeltaKg < 0
                      ? "↓ "
                      : recap.weightDeltaKg > 0
                        ? "↑ "
                        : ""}
                    {Math.abs(kgToDisplay(recap.weightDeltaKg, units)).toFixed(
                      1,
                    )}{" "}
                    {units === "imperial" ? "lb" : "kg"}
                  </span>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function WeightSection({
  entries,
  targetWindow,
  units,
}: {
  entries: WeightEntry[] | null;
  targetWindow: number;
  units: "metric" | "imperial";
}) {
  const loading = entries === null;
  const windowed = entries ? entries.slice(-targetWindow) : [];
  const hasData = windowed.length > 0;
  const first = hasData ? windowed[0] : null;
  const latest = hasData ? windowed[windowed.length - 1] : null;
  const deltaKg = first && latest ? latest.kg - first.kg : 0;

  // Convert each weigh-in at the data-source boundary so the chart
  // (which renders whatever Y values it's given) doesn't need to
  // know about kg vs lb. Headline + axis use the matching unit
  // label so everything reads consistently.
  const points: LinePoint[] = windowed.map((e) => ({
    x: dayIndex(e.date),
    y: kgToDisplay(e.kg, units),
    label: shortLabel(e.date),
  }));
  const unitLabel = units === "imperial" ? "lb" : "kg";
  const latestDisplay = latest ? kgToDisplay(latest.kg, units) : 0;
  const deltaDisplay = kgToDisplay(deltaKg, units);

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">Weight</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Last {targetWindow} days. Auto-logs when you change your weight on
              the Calculator tab.
            </p>
          </div>
          {hasData && latest && first && (
            <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 sm:flex-nowrap sm:justify-end">
              <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
                <NumberTicker
                  value={latestDisplay}
                  decimals={1}
                  suffix={` ${unitLabel}`}
                />
              </p>
              {windowed.length > 1 && (
                <p className="flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
                  {deltaKg < 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : deltaKg > 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : null}
                  {deltaDisplay > 0 ? "+" : ""}
                  {deltaDisplay.toFixed(1)} {unitLabel} since{" "}
                  {shortLabel(first.date)}
                </p>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="px-5 py-6">
        {loading ? (
          <Skeleton />
        ) : hasData ? (
          <ChartZoomDialog
            title="Weight"
            description={`Last ${targetWindow} days. Tap any point in the expanded view for the exact value.`}
          >
            <MiniLineChart
              data={points}
              height={240}
              yUnit={` ${unitLabel}`}
            />
          </ChartZoomDialog>
        ) : (
          <EmptyState
            title="No weigh-ins yet"
            body="Update your weight on the Calculator tab - or use the form below to log a measurement directly."
          />
        )}
      </div>
    </section>
  );
}

function CalorieSection({
  logs,
  targetCalories,
  targetWindow,
}: {
  logs: DailyLog[] | null;
  targetCalories: number;
  targetWindow: number;
}) {
  const loading = logs === null;
  // Future dates exist in `logs` whenever the user meal-plans `n`
  // days ahead - the meal planner persists the plan into the
  // `dailyLogs` store with the future date as the row key. Those
  // entries shouldn't contribute to the "Calorie adherence" chart
  // and especially not to its `slice(-7)` rolling average, which
  // would sort future dates to the end and average them in,
  // dragging the headline number well below the user's actual
  // intake. Anchor on today as the upper bound to keep the chart
  // honest. (The weekly recap above this one is already correctly
  // windowed via `computeWeeklyRecap`; this fix brings the line
  // chart's average into agreement with that surface.)
  const today = todayKey();

  // Roll log totals up to a per-day calorie series, oldest first.
  const series = (logs ?? [])
    .filter((l) => l.date <= today)
    .map((l) => ({
      date: l.date,
      calories: l.meals.reduce(
        (s, m) => s + m.foods.reduce((ms, f) => ms + f.calories, 0),
        0,
      ),
    }))
    .filter((p) => p.calories > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-targetWindow);

  const hasData = series.length > 0;

  const points: LinePoint[] = series.map((p) => ({
    x: dayIndex(p.date),
    y: p.calories,
    label: shortLabel(p.date),
  }));

  // 7-day rolling average of calories - the comparison most fitness
  // practitioners care about, since day-to-day adherence is noisy.
  const last7 = series.slice(-7);
  const avg7 =
    last7.length > 0
      ? last7.reduce((s, p) => s + p.calories, 0) / last7.length
      : 0;
  const adherencePct =
    last7.length > 0 && targetCalories > 0
      ? Math.round((avg7 / targetCalories) * 100)
      : 0;

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">
              Calorie adherence
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Logged calories per day vs your current target of{" "}
              {targetCalories.toLocaleString()} kcal.
            </p>
          </div>
          {hasData && (
            <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 sm:flex-nowrap sm:justify-end">
              <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
                <NumberTicker value={Math.round(avg7)} />
                <span className="ml-1 text-sm text-muted-foreground">
                  / 7d avg
                </span>
              </p>
              <p
                className={cn(
                  "font-mono text-xs tabular-nums",
                  adherencePct >= 90 && adherencePct <= 110
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {adherencePct}% of target
              </p>
            </div>
          )}
        </div>
      </header>

      <div className="px-5 py-6">
        {loading ? (
          <Skeleton />
        ) : hasData ? (
          <ChartZoomDialog
            title="Calorie adherence"
            description="Tap any point in the expanded view to see the exact value."
          >
            <MiniLineChart
              data={points}
              height={240}
              targetY={targetCalories}
              targetLabel={`${targetCalories} kcal target`}
            />
          </ChartZoomDialog>
        ) : (
          <EmptyState
            title="No logs yet"
            body="Add foods on the Meal Plan tab - once you've logged a day or two, your adherence will show up here."
          />
        )}
      </div>
    </section>
  );
}

function HydrationSection({
  entries,
  goalMl,
  override,
  units,
  targetWindow,
  onSetGoal,
}: {
  entries: WaterIntake[] | null;
  goalMl: number;
  override: number | null | undefined;
  units: "metric" | "imperial";
  targetWindow: number;
  onSetGoal: (ml: number | null) => void;
}) {
  const loading = entries === null;
  const today = todayKey();

  // Per-day series, oldest first, today as the upper bound (future-dated
  // rows can't exist for water, but stay symmetric with CalorieSection).
  const series = (entries ?? [])
    .filter((e) => e.date <= today && e.ml > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-targetWindow);
  const hasData = series.length > 0;

  const points: LinePoint[] = series.map((e) => ({
    x: dayIndex(e.date),
    y: e.ml,
    label: shortLabel(e.date),
  }));

  const todayMl = series.find((e) => e.date === today)?.ml ?? 0;
  const goalPct = goalMl > 0 ? Math.round((todayMl / goalMl) * 100) : 0;

  // Inline goal editor — seeded from the current goal each time it opens.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function startEdit() {
    setDraft(String(mlToDisplay(goalMl, units)));
    setEditing(true);
  }
  function save() {
    const n = Number.parseFloat(draft);
    if (Number.isFinite(n) && n > 0) onSetGoal(displayToMl(n, units));
    setEditing(false);
  }
  function reset() {
    onSetGoal(null);
    setEditing(false);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              <Droplets className="h-4 w-4 text-sky-500" />
              Hydration
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Water logged per day vs your goal of {formatVolume(goalMl, units)}
              .
            </p>
          </div>
          {hasData && (
            <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 sm:flex-nowrap sm:justify-end">
              <p className="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
                <NumberTicker value={mlToDisplay(todayMl, units)} />
                <span className="ml-1 text-sm text-muted-foreground">
                  {volumeUnitSuffix(units)} today
                </span>
              </p>
              <p
                className={cn(
                  "font-mono text-xs tabular-nums",
                  goalPct >= 100
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-muted-foreground",
                )}
              >
                {goalPct}% of goal
              </p>
            </div>
          )}
        </div>
      </header>

      <div className="px-5 py-6">
        {loading ? (
          <Skeleton />
        ) : hasData ? (
          <ChartZoomDialog
            title="Hydration"
            description="Tap any point in the expanded view to see the exact value."
          >
            <MiniLineChart
              data={points}
              height={240}
              targetY={goalMl}
              targetLabel={`${formatVolume(goalMl, units)} goal`}
            />
          </ChartZoomDialog>
        ) : (
          <EmptyState
            title="No water logged yet"
            body="Tap the water counter on the Meal Plan tab to log a glass — your daily totals will chart here."
          />
        )}
      </div>

      <div className="border-t border-border/60 px-5 py-4">
        {editing ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[8rem] flex-1">
              <Label
                htmlFor="water-goal-input"
                className="text-xs text-muted-foreground"
              >
                Daily goal ({volumeUnitSuffix(units)})
              </Label>
              <Input
                id="water-goal-input"
                type="number"
                inputMode="numeric"
                min="1"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="mt-1 h-9 font-mono tabular-nums"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9"
              onClick={save}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={reset}
            >
              Auto
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Daily goal: {formatVolume(goalMl, units)}
              {override == null || override <= 0
                ? " — auto, from your bodyweight"
                : " — manual"}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              onClick={startEdit}
            >
              Edit goal
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function WeighInForm({
  onSaved,
  units,
}: {
  onSaved: () => void;
  units: "metric" | "imperial";
}) {
  // SSR-safe "today": `useToday()` yields "" on the server and during
  // hydration, then the real local date — so the date input's value/max
  // can't differ between a UTC server render and the user's local
  // client (the source of an intermittent hydration mismatch). `picked`
  // holds an explicit user choice; until then the field follows today.
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  // The input field carries the value in the user's units; we
  // convert to kg only at save-time so the canonical store stays
  // metric.
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitLabel = units === "imperial" ? "lb" : "kg";
  const minDisplay = units === "imperial" ? 44 : 20;
  const maxDisplay = units === "imperial" ? 660 : 300;

  async function save() {
    setError(null);
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) {
      setError(`Enter a positive weight in ${unitLabel}.`);
      return;
    }
    const kg = units === "imperial" ? displayToKg(value, "imperial") : value;
    setSaving(true);
    try {
      await saveWeightEntry(date, kg);
      reportStorageOk();
      bumpPending();
      setRaw("");
      setPicked(null); // back to following today
      setJustSaved(true);
      onSaved();
      window.setTimeout(() => setJustSaved(false), 1500);
    } catch (e) {
      reportStorageError(e);
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border/60 bg-card px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Log weigh-in</h3>
        <p className="text-[11px] text-muted-foreground">
          Same-day entries overwrite.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label
            htmlFor="weigh-in-date"
            className="text-xs font-medium text-muted-foreground"
          >
            Date
          </Label>
          <Input
            id="weigh-in-date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setPicked(e.target.value)}
            className="font-mono tabular-nums"
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label
            htmlFor="weigh-in-kg"
            className="text-xs font-medium text-muted-foreground"
          >
            Weight ({unitLabel})
          </Label>
          <Input
            id="weigh-in-kg"
            type="number"
            min={minDisplay}
            max={maxDisplay}
            step="0.1"
            placeholder={units === "imperial" ? "e.g. 155.5" : "e.g. 70.5"}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="font-mono tabular-nums"
          />
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={saving || raw.trim() === ""}
          className="h-9 gap-1.5"
        >
          {justSaved ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Saved
            </>
          ) : saving ? (
            "Saving…"
          ) : (
            "Save"
          )}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 text-xs text-red-600"
        >
          {error}
        </p>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="h-2 w-24 animate-pulse rounded bg-muted" />
      <div className="h-[200px] animate-pulse rounded bg-muted/40" />
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <LineChart
          className="h-5 w-5 text-muted-foreground"
          aria-hidden
        />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Body measurements                                                 */
/* ---------------------------------------------------------------- */

function BodyMeasurementsSection({
  entries,
  gender,
  heightCm,
  targetWindow,
  units,
  onSaved,
}: {
  entries: BodyMeasurement[] | null;
  gender: "male" | "female" | "nonbinary" | "preferNotToSay";
  heightCm: number;
  targetWindow: number;
  units: "metric" | "imperial";
  onSaved: () => void;
}) {
  const recent = useMemo(() => {
    if (!entries) return [];
    return entries.slice(-targetWindow);
  }, [entries, targetWindow]);

  const latest = recent.length > 0 ? recent[recent.length - 1] : null;
  const previous = recent.length > 1 ? recent[recent.length - 2] : null;

  // Body-fat estimate uses gender + height + the latest entry. Only
  // available when (1) gender is male/female (no published formula
  // for non-binary bodies) and (2) all required inputs are present.
  // The category label is rendered alongside the percentage to give
  // the number context.
  const bfBodyType: "male" | "female" | null =
    gender === "male" || gender === "female" ? gender : null;
  const latestBf = useMemo(() => {
    if (!latest || !bfBodyType) return null;
    return estimateBodyFat({
      bodyType: bfBodyType,
      heightCm,
      waistCm: latest.waistCm ?? 0,
      neckCm: latest.neckCm ?? 0,
      hipCm: latest.hipsCm,
    });
  }, [latest, bfBodyType, heightCm]);

  // Trend points for the BF% sparkline - only entries that have all
  // required inputs contribute. The chart skips days where an input
  // was missing rather than interpolating.
  const bfTrend = useMemo<LinePoint[]>(() => {
    if (!bfBodyType || recent.length === 0) return [];
    const points: LinePoint[] = [];
    for (const e of recent) {
      const bf = estimateBodyFat({
        bodyType: bfBodyType,
        heightCm,
        waistCm: e.waistCm ?? 0,
        neckCm: e.neckCm ?? 0,
        hipCm: e.hipsCm,
      });
      if (bf !== null) {
        points.push({
          x: dayIndex(e.date),
          y: bf,
          label: shortLabel(e.date),
          tooltipLabel: shortLabel(e.date),
        });
      }
    }
    return points;
  }, [recent, bfBodyType, heightCm]);

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="flex items-baseline justify-between gap-2 border-b border-border/60 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            Body measurements
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Waist / neck / hips in {units === "imperial" ? "inches" : "cm"}.
            Body-fat estimate via the US Navy formula when inputs are complete.
          </p>
        </div>
      </header>

      {entries === null ? (
        // Reserve the metric grid's height (mirrors the Metric cells), so
        // the card holds its size on load like the sibling chart sections.
        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5"
              >
                <div className="h-2.5 w-12 animate-pulse rounded bg-muted/70" />
                <div className="mt-1.5 h-5 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ) : latest === null ? (
        <EmptyState
          title="No measurements yet"
          body="Log waist, neck, and hips (plus optional notes) to track composition alongside weight."
        />
      ) : (
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Waist"
              cm={latest.waistCm}
              prevCm={previous?.waistCm}
              units={units}
            />
            <Metric
              label="Neck"
              cm={latest.neckCm}
              prevCm={previous?.neckCm}
              units={units}
            />
            <Metric
              label="Hips"
              cm={latest.hipsCm}
              prevCm={previous?.hipsCm}
              units={units}
            />
            <BodyFatMetric
              bf={latestBf}
              bodyType={bfBodyType}
            />
          </div>

          {bfTrend.length >= 2 && (
            <div className="rounded-md border border-border/60 bg-background/40 px-3 py-3">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Body fat % over last {targetWindow} days
              </p>
              <ChartZoomDialog
                title="Body fat %"
                description={`Last ${targetWindow} days. Tap any point in the expanded view for the exact value.`}
              >
                <MiniLineChart
                  data={bfTrend}
                  yUnit="%"
                  height={160}
                />
              </ChartZoomDialog>
            </div>
          )}
        </div>
      )}
      <BodyMeasurementForm
        latest={latest}
        units={units}
        onSaved={onSaved}
      />
    </section>
  );
}

function Metric({
  label,
  cm,
  prevCm,
  units,
}: {
  label: string;
  cm: number | undefined;
  prevCm: number | undefined;
  units: "metric" | "imperial";
}) {
  const delta = cm !== undefined && prevCm !== undefined ? cm - prevCm : null;
  const deltaColor =
    delta === null
      ? "text-muted-foreground"
      : delta < 0
        ? "text-emerald-600 dark:text-emerald-400"
        : delta > 0
          ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground";
  const unitLabel = units === "imperial" ? "in" : "cm";
  const toDisplay = (value: number): number =>
    units === "imperial" ? cmToInches(value) : value;
  return (
    <div className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {cm !== undefined ? `${toDisplay(cm).toFixed(1)} ${unitLabel}` : "-"}
      </p>
      {delta !== null && (
        <p
          className={`mt-0.5 font-mono text-[10px] tabular-nums ${deltaColor}`}
        >
          {delta < 0 ? "↓ " : delta > 0 ? "↑ " : ""}
          {Math.abs(toDisplay(delta)).toFixed(1)} {unitLabel} vs prev
        </p>
      )}
    </div>
  );
}

function BodyFatMetric({
  bf,
  bodyType,
}: {
  bf: number | null;
  bodyType: "male" | "female" | null;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Body fat
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
        {bf !== null ? `${bf.toFixed(1)}%` : "-"}
      </p>
      {bf !== null && bodyType !== null && (
        <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">
          {bodyFatCategory(bf, bodyType)}
        </p>
      )}
      {bodyType === null && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          gender not set
        </p>
      )}
    </div>
  );
}

/** Inline form for logging waist / neck / hips / notes. Mirrors
 *  WeighInForm's UX (date + numeric inputs + save with feedback)
 *  but accepts multiple measurements at once. Pre-fills with the
 *  latest entry's values so re-logging is a one-tap edit.
 *
 *  We accept any combination of waist/neck/hips - the body-fat
 *  estimate just hides when inputs are incomplete. */
function BodyMeasurementForm({
  latest,
  units,
  onSaved,
}: {
  latest: BodyMeasurement | null;
  units: "metric" | "imperial";
  onSaved: () => void;
}) {
  // Seed the inputs in the user's preferred system. Storage stays
  // cm; we only convert at the form's input/output boundary.
  const toDisplay = (cm: number | undefined): string => {
    if (cm === undefined) return "";
    const value = units === "imperial" ? cmToInches(cm) : cm;
    return value.toFixed(1);
  };
  // SSR-safe "today" — see WeighInForm above for why render-time
  // `todayKey()` on a date input causes an intermittent hydration
  // mismatch under a UTC-server / local-client timezone split.
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const [waist, setWaist] = useState<string>(toDisplay(latest?.waistCm));
  const [neck, setNeck] = useState<string>(toDisplay(latest?.neckCm));
  const [hips, setHips] = useState<string>(toDisplay(latest?.hipsCm));
  const [notes, setNotes] = useState<string>(latest?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitLabel = units === "imperial" ? "in" : "cm";

  /** Parse the input as the active display unit, convert to cm for
   *  storage. Empty string → undefined; non-positive / NaN →
   *  undefined (treated as "not provided" rather than "zero"). */
  function parseValue(raw: string): number | undefined {
    if (raw.trim() === "") return undefined;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return units === "imperial" ? inchesToCm(n) : n;
  }

  async function save() {
    setError(null);
    const values = {
      waistCm: parseValue(waist),
      neckCm: parseValue(neck),
      hipsCm: parseValue(hips),
      notes: notes.trim() === "" ? undefined : notes.trim(),
    };
    // At least one circumference must be present - empty rows would
    // pollute the chart trend without giving any signal.
    if (
      values.waistCm === undefined &&
      values.neckCm === undefined &&
      values.hipsCm === undefined
    ) {
      setError("Enter at least one measurement.");
      return;
    }
    setSaving(true);
    try {
      await saveBodyMeasurement(date, values);
      reportStorageOk();
      bumpPending();
      setJustSaved(true);
      onSaved();
      window.setTimeout(() => setJustSaved(false), 1500);
    } catch (e) {
      reportStorageError(e);
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-border/60 px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Log measurements
        </h4>
        <p className="text-[11px] text-muted-foreground">
          Same-day entries overwrite.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label
            htmlFor="bm-date"
            className="text-xs font-medium text-muted-foreground"
          >
            Date
          </Label>
          <Input
            id="bm-date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setPicked(e.target.value)}
            className="font-mono tabular-nums"
          />
        </div>
        <CmField
          id="bm-waist"
          label={`Waist (${unitLabel})`}
          placeholder={units === "imperial" ? "e.g. 32" : "e.g. 82"}
          value={waist}
          onChange={setWaist}
        />
        <CmField
          id="bm-neck"
          label={`Neck (${unitLabel})`}
          placeholder={units === "imperial" ? "e.g. 15" : "e.g. 38"}
          value={neck}
          onChange={setNeck}
        />
        <CmField
          id="bm-hips"
          label={`Hips (${unitLabel})`}
          placeholder={units === "imperial" ? "e.g. 37" : "e.g. 95"}
          value={hips}
          onChange={setHips}
        />
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label
            htmlFor="bm-notes"
            className="text-xs font-medium text-muted-foreground"
          >
            Notes (optional)
          </Label>
          <Input
            id="bm-notes"
            type="text"
            placeholder="e.g. morning, fasted"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 text-xs text-red-600"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-9"
        >
          {saving ? "Saving…" : "Save measurement"}
        </Button>
        {/* Live region for screen readers — `role="status"` +
            `aria-live="polite"` means the "Saved" text is announced
            when it appears after a successful save (instead of only
            being visible to sighted users). The region stays in the
            DOM so the announcement fires reliably when the inner
            content transitions from empty to populated. */}
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
        >
          {justSaved && (
            <>
              <Check
                className="h-3.5 w-3.5"
                aria-hidden
              />
              Saved
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function CmField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        // No browser-side min / max — the bounds for "waist in cm"
        // (~50–150) vs "waist in inches" (~20–60) differ enough
        // that a single static range would block legitimate
        // imperial inputs. `parseValue` in the caller enforces
        // `n > 0`, which is the only invariant that matters; the
        // rest is honour-system data entry.
        step="0.1"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono tabular-nums"
      />
    </div>
  );
}
