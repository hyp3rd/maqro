"use client";

import type { PersonalInfo } from "@/components/macro/types";
import { MiniLineChart } from "@/components/shell/MiniLineChart";
import { Button } from "@/components/ui/button";
import { effectiveAge } from "@/lib/age";
import { bodyFatCategory, estimateBodyFat } from "@/lib/body-fat";
import {
  getProfile,
  listBodyMeasurements,
  listDailyLogs,
  listMicronutrientProfiles,
  listWeightEntries,
  type BodyMeasurement,
  type DailyLog,
  type WeightEntry,
} from "@/lib/db";
import { computeMacros } from "@/lib/macros";
import {
  averageMicronutrients,
  computeMicronutrientWindow,
} from "@/lib/micronutrients/aggregate";
import type { MicronutrientProfile } from "@/lib/micronutrients/types";
import {
  getMicronutrientTargets,
  MICRONUTRIENT_KEYS,
  MICRONUTRIENTS,
  type MicronutrientKey,
} from "@/lib/rda";
import { computeStreak, type StreakState } from "@/lib/streaks";
import {
  ADAPTIVE_DELTA_THRESHOLD,
  confidenceLabel,
  detectPlateau,
  inferAdaptiveTdee,
  recalibrateTdee,
  type AdaptiveTdee,
} from "@/lib/trends";
import { cmToInches, kgToDisplay } from "@/lib/units";
import { APP_VERSION } from "@/lib/version";
import { computeWeeklyRecap, type WeeklyRecap } from "@/lib/weekly-recap";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Dedicated print-optimised progress report.
 *
 *  Reached via the Export-progress dialog on /app → reads its
 *  options from the URL (`?days=…&sections=…&title=…&note=…`),
 *  loads the same IDB stores ProgressView reads, and renders a
 *  single-column, print-first layout. A sticky toolbar at the top
 *  gives the user a clean "Save as PDF" affordance + a "Back to
 *  the app" escape; both hide on print.
 *
 *  Why a dedicated route over an in-page modal: print preview
 *  shows exactly what the route renders. Form inputs (the Log
 *  weigh-in date + the body-measurement fields on /progress) never
 *  appear here, the layout flows top-down without grid quirks
 *  fighting the page break, and the URL is shareable / re-printable
 *  without touching app state. */
export default function ReportPage() {
  return (
    <Suspense fallback={<ReportLoading />}>
      <ReportClient />
    </Suspense>
  );
}

function ReportLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Building report…
    </div>
  );
}

function ReportClient() {
  const params = useSearchParams();
  const days = clampDays(Number(params.get("days") ?? "60"));
  const rawSections =
    params.get("sections") ?? "summary,trends,weight,body,calories";
  const enabled = new Set(rawSections.split(",").filter(Boolean));
  const title = params.get("title") ?? "Maqro progress report";
  const note = params.get("note") ?? "";

  const [state, setState] = useState<
    | { kind: "loading" }
    | {
        kind: "ok";
        profile: PersonalInfo | null;
        weights: WeightEntry[];
        logs: DailyLog[];
        measurements: BodyMeasurement[];
        micronutrientProfiles: MicronutrientProfile[];
      }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getProfile(),
      listWeightEntries(),
      listDailyLogs(),
      listBodyMeasurements(),
      listMicronutrientProfiles(),
    ])
      .then(([profile, weights, logs, measurements, micronutrientProfiles]) => {
        if (cancelled) return;
        setState({
          kind: "ok",
          profile,
          weights: weights ?? [],
          logs: logs ?? [],
          measurements: measurements ?? [],
          micronutrientProfiles: micronutrientProfiles ?? [],
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't load data",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <ReportLoading />;
  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <ReportBody
      title={title}
      note={note}
      days={days}
      enabled={enabled}
      profile={state.profile}
      weights={state.weights}
      logs={state.logs}
      measurements={state.measurements}
      micronutrientProfiles={state.micronutrientProfiles}
    />
  );
}

function ReportBody({
  title,
  note,
  days,
  enabled,
  profile,
  weights,
  logs,
  measurements,
  micronutrientProfiles,
}: {
  title: string;
  note: string;
  days: number;
  enabled: Set<string>;
  profile: PersonalInfo | null;
  weights: WeightEntry[];
  logs: DailyLog[];
  measurements: BodyMeasurement[];
  micronutrientProfiles: MicronutrientProfile[];
}) {
  const today = todayKey();
  const cutoffDate = cutoffDateString(days);

  // Filter every store to the chosen date range before any
  // computation. Keeps derived numbers (delta, adherence,
  // averages) honest about the window the user picked, not the
  // full history that happens to be in IDB.
  const weightsWindow = useMemo(
    () => weights.filter((w) => w.date >= cutoffDate),
    [weights, cutoffDate],
  );
  const logsWindow = useMemo(
    () => logs.filter((l) => l.date >= cutoffDate),
    [logs, cutoffDate],
  );
  const measurementsWindow = useMemo(
    () => measurements.filter((m) => m.date >= cutoffDate),
    [measurements, cutoffDate],
  );

  // Average micronutrient intake over the windowed logs, joined to the
  // name-keyed profiles. Empty for non-Pro users (no profiles) — the
  // section renders nothing in that case.
  const micronutrientAverages = useMemo(() => {
    if (micronutrientProfiles.length === 0) return {};
    const map = new Map(micronutrientProfiles.map((p) => [p.nameKey, p]));
    const window = computeMicronutrientWindow(logsWindow, map, today, days);
    return averageMicronutrients(window);
  }, [micronutrientProfiles, logsWindow, today, days]);

  // Derived stats. Skipped when there's no profile yet — guest-
  // mode users without a saved profile can still print a chart-
  // only report.
  const calc = useMemo(
    () => (profile ? computeMacros(profile) : null),
    [profile],
  );
  const targetCalories = calc?.targetCalories ?? 0;
  const streak = useMemo<StreakState>(
    () => computeStreak(logsWindow, today),
    [logsWindow, today],
  );
  const recap = useMemo<WeeklyRecap>(
    () => computeWeeklyRecap(logsWindow, weightsWindow, targetCalories, today),
    [logsWindow, weightsWindow, targetCalories, today],
  );
  const plateau = useMemo(
    () => detectPlateau(weightsWindow, profile?.goal ?? "maintain"),
    [weightsWindow, profile?.goal],
  );
  const tdeeReco = useMemo(
    () =>
      recalibrateTdee({
        weights: weightsWindow,
        formulaTdee: calc?.tdee ?? 0,
        dailyDelta: calc?.dailyDelta ?? 0,
      }),
    [weightsWindow, calc?.tdee, calc?.dailyDelta],
  );
  // Adaptive TDEE matches the live Progress view: full history (the
  // estimator windows internally), so the PDF shows the same maintenance
  // number regardless of the report's selected date range.
  const adaptive = useMemo<AdaptiveTdee>(() => {
    const intake = logs
      .filter((l) => l.date <= today)
      .map((l) => ({
        date: l.date,
        calories: l.meals.reduce(
          (s, m) => s + m.foods.reduce((ms, f) => ms + f.calories, 0),
          0,
        ),
      }));
    return inferAdaptiveTdee({ weights, intake });
  }, [weights, logs, today]);
  const currentTdee = calc?.tdee ?? 0;
  const showAdaptive =
    adaptive.observedTdee !== null &&
    Math.abs(adaptive.observedTdee - currentTdee) >= ADAPTIVE_DELTA_THRESHOLD;
  const showRecalibration = !showAdaptive && Boolean(tdeeReco.advisory);

  const units = profile?.units ?? "metric";
  const unitLabel = units === "imperial" ? "lb" : "kg";
  const cmUnitLabel = units === "imperial" ? "in" : "cm";

  return (
    <main className="mx-auto max-w-3xl px-safe-or-6 py-8 print:max-w-none print:px-0 print:py-0">
      {/* Toolbar. `print-hide` keeps it out of the PDF. The user
       *  decides when to fire the print dialog — auto-firing on
       *  mount has historically backfired (fires before charts
       *  finish their entry animations, which look truncated in
       *  the static PDF). */}
      <div className="print-hide sticky top-0 z-10 mb-6 flex items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-1 py-2 backdrop-blur">
        <Link
          href="/app"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to app
        </Link>
        <Button
          type="button"
          size="sm"
          onClick={() => window.print()}
          className="gap-1.5"
        >
          <Printer className="h-3.5 w-3.5" />
          Save as PDF
        </Button>
      </div>

      {/* Cover header — always rendered. Title + generated-on +
       *  optional cover note. The cover note is the load-bearing
       *  bit for the "share with a clinician" use case: it lets
       *  the user say "what I'd like you to look at" before any
       *  numbers. */}
      <header className="space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Maqro · maqro.app · v{APP_VERSION}
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        <p className="text-xs text-muted-foreground">
          Generated{" "}
          {new Date().toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}{" "}
          · {days} days of history
        </p>
        {note && (
          <aside className="mt-4 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm leading-relaxed">
            {note}
          </aside>
        )}
        <hr className="my-4 border-t border-border/60" />
      </header>

      {/* When no sections are enabled, render an explainer rather
       *  than an empty page — it's likelier a deep-link mistake
       *  than intent. */}
      {enabled.size === 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          This report has no sections selected.{" "}
          <Link
            href="/app"
            className="underline underline-offset-2"
          >
            Go back
          </Link>{" "}
          and pick at least one.
        </p>
      )}

      <div className="space-y-6 print:space-y-4">
        {enabled.has("summary") && (
          <SummarySection
            streak={streak}
            recap={recap}
            targetCalories={targetCalories}
            unitLabel={unitLabel}
            units={units}
          />
        )}

        {enabled.has("trends") &&
          (plateau.advisory || showAdaptive || showRecalibration) && (
            <TrendsSection
              plateau={plateau}
              adaptive={adaptive}
              tdeeReco={tdeeReco}
              currentTdee={currentTdee}
              showAdaptive={showAdaptive}
              showRecalibration={showRecalibration}
              units={units}
              unitLabel={unitLabel}
            />
          )}

        {enabled.has("weight") && (
          <WeightSection
            entries={weightsWindow}
            units={units}
            unitLabel={unitLabel}
          />
        )}

        {enabled.has("body") && (
          <BodySection
            entries={measurementsWindow}
            profile={profile}
            cmUnitLabel={cmUnitLabel}
            units={units}
          />
        )}

        {enabled.has("calories") && (
          <CalorieSection
            logs={logsWindow}
            targetCalories={targetCalories}
          />
        )}

        {enabled.has("micronutrients") &&
          Object.keys(micronutrientAverages).length > 0 && (
            <MicronutrientReportSection
              averages={micronutrientAverages}
              targets={getMicronutrientTargets(
                profile?.gender === "male" || profile?.gender === "female"
                  ? profile.gender
                  : "unspecified",
                profile ? effectiveAge(profile) : 30,
              )}
              personalized={
                profile?.gender === "male" || profile?.gender === "female"
              }
            />
          )}
      </div>

      <footer className="mt-8 border-t border-border/60 pt-3 text-[10px] text-muted-foreground">
        <p>
          This report reflects locally-stored data on the device that generated
          it. Macro / TDEE estimates are textbook approximations (Mifflin-St
          Jeor) that can diverge 10–20% per individual — see maqro.app/about for
          the formulas and limitations.
        </p>
      </footer>
    </main>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

function SummarySection({
  streak,
  recap,
  targetCalories,
  unitLabel,
  units,
}: {
  streak: StreakState;
  recap: WeeklyRecap;
  targetCalories: number;
  unitLabel: string;
  units: "metric" | "imperial";
}) {
  const adherencePct =
    recap.daysLogged > 0
      ? Math.round((recap.adherenceDays / recap.daysLogged) * 100)
      : 0;
  return (
    <ReportSection title="Summary">
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <Stat
          label="Current streak"
          value={`${streak.current} day${streak.current === 1 ? "" : "s"}`}
          sub={
            streak.longest > streak.current
              ? `Best: ${streak.longest}`
              : "All-time best"
          }
        />
        <Stat
          label="Last 7 days"
          value={`${recap.daysLogged} / 7`}
          sub={
            targetCalories > 0 && recap.daysLogged > 0
              ? `${adherencePct}% within ±10%`
              : "no target context"
          }
        />
        <Stat
          label="Avg per logged day"
          value={
            recap.daysLogged > 0
              ? `${Math.round(recap.avg.calories)} kcal`
              : "—"
          }
          sub={
            recap.daysLogged > 0
              ? `P${Math.round(recap.avg.protein)} · C${Math.round(recap.avg.carbs)} · F${Math.round(recap.avg.fat)}`
              : ""
          }
        />
      </dl>
      {recap.weightDeltaKg !== null && (
        <p className="mt-3 text-xs text-muted-foreground">
          Week-on-week weight delta:{" "}
          <span className="font-mono">
            {recap.weightDeltaKg > 0 ? "+" : ""}
            {kgToDisplay(recap.weightDeltaKg, units).toFixed(1)} {unitLabel}
          </span>
        </p>
      )}
    </ReportSection>
  );
}

function TrendsSection({
  plateau,
  adaptive,
  tdeeReco,
  currentTdee,
  showAdaptive,
  showRecalibration,
  units,
  unitLabel,
}: {
  plateau: ReturnType<typeof detectPlateau>;
  adaptive: AdaptiveTdee;
  tdeeReco: ReturnType<typeof recalibrateTdee>;
  currentTdee: number;
  showAdaptive: boolean;
  showRecalibration: boolean;
  units: "metric" | "imperial";
  unitLabel: string;
}) {
  const observed = adaptive.observedTdee;
  return (
    <ReportSection title="Trends">
      {plateau.advisory && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Plateau detected</p>
          <p className="text-sm text-muted-foreground">{plateau.advisory}</p>
          {plateau.startKg !== null && plateau.endKg !== null && (
            <p className="font-mono text-[11px] text-muted-foreground">
              Smoothed weight: {kgToDisplay(plateau.startKg, units).toFixed(1)}{" "}
              → {kgToDisplay(plateau.endKg, units).toFixed(1)} {unitLabel} over{" "}
              {plateau.daysFlat} days.
            </p>
          )}
        </div>
      )}
      {showAdaptive && observed !== null && (
        <div className="mt-3 space-y-1">
          <p className="text-sm font-medium">Adaptive TDEE</p>
          <p className="text-sm text-muted-foreground">
            Your last {adaptive.windowDays} days of logging put your maintenance
            near {observed} kcal/day — about {Math.abs(observed - currentTdee)}{" "}
            kcal {observed > currentTdee ? "higher" : "lower"} than the{" "}
            {currentTdee.toLocaleString()} kcal your targets use now, measured
            from logged intake.
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {adaptive.loggedDays} logged days
            {adaptive.weightSlopeKgPerWeek !== null &&
              ` · trend ${adaptive.weightSlopeKgPerWeek > 0 ? "+" : ""}${kgToDisplay(
                adaptive.weightSlopeKgPerWeek,
                units,
              ).toFixed(2)} ${unitLabel}/wk`}
            {confidenceLabel(adaptive.confidence) &&
              ` · ${confidenceLabel(adaptive.confidence)}`}
            .
          </p>
        </div>
      )}
      {showRecalibration && (
        <div className="mt-3 space-y-1">
          <p className="text-sm font-medium">TDEE recalibration</p>
          <p className="text-sm text-muted-foreground">{tdeeReco.advisory}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            Based on {tdeeReco.windowDays} days · actual change{" "}
            {tdeeReco.weightChangeKg > 0 ? "+" : ""}
            {kgToDisplay(tdeeReco.weightChangeKg, units).toFixed(2)} {unitLabel}{" "}
            · suggested manual TDEE {tdeeReco.suggestedTdee} kcal.
          </p>
        </div>
      )}
    </ReportSection>
  );
}

function WeightSection({
  entries,
  units,
  unitLabel,
}: {
  entries: WeightEntry[];
  units: "metric" | "imperial";
  unitLabel: string;
}) {
  if (entries.length === 0) {
    return (
      <ReportSection title="Weight">
        <p className="text-sm text-muted-foreground">
          No weigh-ins in this window.
        </p>
      </ReportSection>
    );
  }
  // Bounds-check matched the early-return above (entries.length > 0),
  // but the lint rule wants explicit guards rather than non-null
  // assertions. Short-circuit defensively.
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) return null;
  const deltaKg = last.kg - first.kg;
  const points = entries.map((e) => ({
    x: Math.floor(new Date(e.date).getTime() / 86_400_000),
    y: kgToDisplay(e.kg, units),
    label: shortDateLabel(e.date),
  }));
  return (
    <ReportSection title="Weight">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p className="font-mono text-xl font-semibold tabular-nums">
          {kgToDisplay(last.kg, units).toFixed(1)} {unitLabel}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {deltaKg > 0 ? "+" : ""}
          {kgToDisplay(deltaKg, units).toFixed(1)} {unitLabel} since{" "}
          {shortDateLabel(first.date)} ({entries.length} weigh-ins)
        </p>
      </div>
      <MiniLineChart
        data={points}
        height={220}
        yUnit={` ${unitLabel}`}
      />
    </ReportSection>
  );
}

function BodySection({
  entries,
  profile,
  cmUnitLabel,
  units,
}: {
  entries: BodyMeasurement[];
  profile: PersonalInfo | null;
  cmUnitLabel: string;
  units: "metric" | "imperial";
}) {
  if (entries.length === 0) {
    return (
      <ReportSection title="Body composition">
        <p className="text-sm text-muted-foreground">
          No measurements logged in this window.
        </p>
      </ReportSection>
    );
  }
  const latest = entries[entries.length - 1];
  if (!latest) return null;
  const bodyType: "male" | "female" | null =
    profile?.gender === "male" || profile?.gender === "female"
      ? profile.gender
      : null;
  const bf =
    bodyType && profile
      ? estimateBodyFat({
          bodyType,
          heightCm: profile.height,
          waistCm: latest.waistCm ?? 0,
          neckCm: latest.neckCm ?? 0,
          hipCm: latest.hipsCm,
        })
      : null;
  const toDisplay = (cm: number | undefined) =>
    cm === undefined
      ? "—"
      : `${(units === "imperial" ? cmToInches(cm) : cm).toFixed(1)} ${cmUnitLabel}`;
  return (
    <ReportSection title="Body composition">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Latest measurements ({shortDateLabel(latest.date)})
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat
          label="Waist"
          value={toDisplay(latest.waistCm)}
        />
        <Stat
          label="Neck"
          value={toDisplay(latest.neckCm)}
        />
        <Stat
          label="Hips"
          value={toDisplay(latest.hipsCm)}
        />
        <Stat
          label="Body fat"
          value={bf !== null ? `${bf.toFixed(1)}%` : "—"}
          sub={
            bf !== null && bodyType !== null
              ? bodyFatCategory(bf, bodyType)
              : undefined
          }
        />
      </dl>
      {latest.notes && (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          Notes: {latest.notes}
        </p>
      )}
    </ReportSection>
  );
}

function CalorieSection({
  logs,
  targetCalories,
}: {
  logs: DailyLog[];
  targetCalories: number;
}) {
  if (logs.length === 0) {
    return (
      <ReportSection title="Calorie adherence">
        <p className="text-sm text-muted-foreground">
          No daily logs in this window.
        </p>
      </ReportSection>
    );
  }
  const points = logs.map((l) => {
    const cal = sumCalories(l);
    return {
      x: Math.floor(new Date(l.date).getTime() / 86_400_000),
      y: cal,
      label: shortDateLabel(l.date),
    };
  });
  return (
    <ReportSection title="Calorie adherence">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Daily kcal vs target of {targetCalories} kcal.
      </p>
      <MiniLineChart
        data={points}
        height={220}
        targetY={targetCalories || undefined}
        targetLabel={
          targetCalories ? `${targetCalories} kcal target` : undefined
        }
      />
    </ReportSection>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  // `break-inside: avoid` (and the print-friendly border) so each
  // section stays whole on a single PDF page when it fits.
  return (
    <section className="break-inside-avoid rounded-lg border border-border/60 bg-card p-5 print:rounded-none print:border-foreground/30 print:bg-transparent print:p-3">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground print:mb-2 print:text-black">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Micronutrients report section — average daily intake vs FDA Daily
 *  Value, as a labelled bar per nutrient. Print-styled to match the
 *  other sections (whole-on-a-page, ink-friendly borders). Only the
 *  nutrients with data render a filled bar; the rest show "no data"
 *  so a clinician reading the PDF sees coverage honestly. */
function MicronutrientReportSection({
  averages,
  targets,
  personalized,
}: {
  averages: Partial<Record<MicronutrientKey, number>>;
  targets: Record<MicronutrientKey, number>;
  personalized: boolean;
}) {
  return (
    <section className="break-inside-avoid rounded-lg border border-border/60 bg-card p-5 print:rounded-none print:border-foreground/30 print:bg-transparent print:p-3">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground print:text-black">
        Micronutrients
      </h2>
      <p className="mb-3 text-xs text-muted-foreground print:text-black">
        Average daily intake vs{" "}
        {personalized
          ? "the recommended intake for this person's age and sex (NIH DRI)"
          : "the FDA Daily Value"}
        , from foods enriched via Open Food Facts. Approximate — branded /
        barcode foods are most accurate; values for foods Open Food Facts
        doesn&apos;t list are AI-estimated; foods with no data either way are
        excluded.
      </p>
      <ul className="space-y-2.5">
        {MICRONUTRIENT_KEYS.map((key) => {
          const meta = MICRONUTRIENTS[key];
          const target = targets[key];
          const value = averages[key];
          const hasValue = typeof value === "number";
          const pct = hasValue
            ? Math.min(Math.round((value / target) * 100), 100)
            : 0;
          return (
            <li key={key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs print:text-black">
                <span className="font-medium">{meta.label}</span>
                {hasValue ? (
                  <span className="font-mono tabular-nums text-muted-foreground print:text-black">
                    {value >= 10
                      ? Math.round(value)
                      : Math.round(value * 10) / 10}{" "}
                    {meta.unit}
                    <span className="ml-1.5 text-muted-foreground/70">
                      {Math.round((value / target) * 100)}% target
                    </span>
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground/60">
                    no data
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted print:border print:border-foreground/20 print:bg-transparent">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: `hsl(var(${meta.cssVar}))`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
        {value}
      </dd>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Tiny utilities (inlined to keep the report self-contained) ───────

function clampDays(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.min(365, Math.round(n));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Hoisted out of the component body to sidestep `react-hooks/purity`
 *  (Date.now is impure-by-rule even in client components). Returns
 *  the lower-bound date string for filtering window-scoped data. */
function cutoffDateString(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function shortDateLabel(d: string): string {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function sumCalories(log: DailyLog): number {
  let cal = 0;
  for (const meal of log.meals) {
    for (const food of meal.foods) {
      cal += food.calories;
    }
  }
  return cal;
}
