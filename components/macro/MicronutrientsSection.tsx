"use client";

import { UpgradeDialog } from "@/components/macro/UpgradeDialog";
import type { PersonalInfo } from "@/components/macro/types";
import { ChartZoomDialog } from "@/components/shell/ChartZoomDialog";
import {
  MiniLineChart,
  type LinePoint,
} from "@/components/shell/MiniLineChart";
import { useAiUsage } from "@/hooks/use-ai-usage";
import { effectiveAge } from "@/lib/age";
import { FEATURES } from "@/lib/billing/tiers";
import type { DailyLog } from "@/lib/db";
import { getProfile, listMicronutrientProfiles, todayKey } from "@/lib/db";
import {
  averageMicronutrientsDetailed,
  computeMicronutrientWindow,
  foodNameKey,
  type MicronutrientDay,
} from "@/lib/micronutrients/aggregate";
import type { MicronutrientProfile } from "@/lib/micronutrients/types";
import {
  getMicronutrientTargets,
  MICRONUTRIENT_KEYS,
  MICRONUTRIENTS,
  type BiologicalSex,
  type MicronutrientKey,
} from "@/lib/rda";
import { useDataRev } from "@/lib/sync/data-bus";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

/** Micronutrients card on the Progress view (Pro-only).
 *
 *  Shows average daily intake of the ~10 tracked nutrients over the
 *  logged window, each as a bar against its FDA Daily Value. The
 *  figure is the mean across days that actually carried the nutrient
 *  (habitual intake), which is the read a medical advisor cares about.
 *
 *  Data comes from the name-keyed micronutrient profiles the
 *  enrichment cron writes (and sync pulls). A food with no profile
 *  yet — not enriched, or absent from Open Food Facts — simply
 *  doesn't contribute, so the card honestly shows partial coverage
 *  rather than a misleading zero.
 *
 *  Gated on Pro via `useAiUsage().tier`. Free/Plus users see an
 *  upgrade prompt in place of the data. The gate is also enforced
 *  server-side (the enqueue + cron routes), so this is UX, not
 *  security. */
export function MicronutrientsSection({
  logs,
  windowDays,
}: {
  logs: DailyLog[] | null;
  windowDays: number;
}) {
  const { state } = useAiUsage();
  const isPro =
    state.status === "ok" && FEATURES.canTrackMicronutrients(state.data.tier);
  const tierResolved = state.status === "ok" || state.status === "anon";

  const [profiles, setProfiles] = useState<MicronutrientProfile[] | null>(null);
  const [userProfile, setUserProfile] = useState<PersonalInfo | null>(null);
  const profilesRev = useDataRev("micronutrientProfiles");
  const userProfileRev = useDataRev("profile");

  useEffect(() => {
    // Only load profiles for Pro users — no point hitting IDB for a
    // gated card the user can't see.
    if (!isPro) return;
    let cancelled = false;
    listMicronutrientProfiles()
      .then((rows) => {
        if (!cancelled) setProfiles(rows);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isPro, profilesRev]);

  useEffect(() => {
    // The user's profile drives age/sex-specific nutrient targets.
    if (!isPro) return;
    let cancelled = false;
    getProfile()
      .then((p) => {
        if (!cancelled) setUserProfile(p);
      })
      .catch(() => {
        if (!cancelled) setUserProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isPro, userProfileRev]);

  // Per-nutrient daily targets: NIH RDA by age + sex, FDA Daily Value
  // fallback. Recomputed when the profile changes.
  const targets = useMemo(
    () =>
      getMicronutrientTargets(
        sexFromGender(userProfile?.gender),
        userProfile ? effectiveAge(userProfile) : 30,
      ),
    [userProfile],
  );
  // Personalized when we actually have a sex-specific profile; drives
  // the header wording (DV vs your target).
  const personalized = sexFromGender(userProfile?.gender) !== "unspecified";

  const today = useMemo(() => todayKey(), []);
  // Track which nutrient's trend chart is expanded (accordion — one at
  // a time). Null = all collapsed.
  const [expanded, setExpanded] = useState<MicronutrientKey | null>(null);

  const { averages, daysWith, daysCovered, window } = useMemo(() => {
    if (!logs || !profiles)
      return {
        averages: {},
        daysWith: {},
        daysCovered: 0,
        window: [] as MicronutrientDay[],
      };
    const map = new Map(profiles.map((p) => [p.nameKey, p]));
    const w = computeMicronutrientWindow(logs, map, today, windowDays);
    const detailed = averageMicronutrientsDetailed(w);
    return {
      averages: detailed.totals,
      daysWith: detailed.daysWith,
      daysCovered: w.length,
      window: w,
    };
  }, [logs, profiles, today, windowDays]);

  // While the tier is still resolving, render nothing — avoids a
  // flash of the upgrade prompt for a Pro user mid-fetch.
  if (!tierResolved) return null;

  if (!isPro) {
    return <MicronutrientsUpgradeCard />;
  }

  const trackedNames = logs ? countTrackedFoodNames(logs, today) : 0;
  const enrichedNames = profiles?.length ?? 0;
  const loading = logs === null || profiles === null;
  const anyData = MICRONUTRIENT_KEYS.some(
    (k) => typeof averages[k] === "number",
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Micronutrients</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Average daily intake over your last {daysCovered || windowDays} logged{" "}
          {daysCovered === 1 ? "day" : "days"}, against{" "}
          {personalized
            ? "the recommended intake for your age and sex"
            : "the FDA Daily Value"}
          . Tap a nutrient to see its day-by-day trend. Vitamins &amp; minerals
          are filled in from Open Food Facts as your foods are enriched.
        </p>
      </header>

      <div className="px-5 py-4">
        {loading ? (
          <div className="space-y-3">
            {MICRONUTRIENT_KEYS.slice(0, 4).map((k) => (
              <div
                key={k}
                className="h-3 w-full animate-pulse rounded bg-muted"
              />
            ))}
          </div>
        ) : anyData ? (
          <ul className="space-y-3">
            {MICRONUTRIENT_KEYS.map((key) => (
              <NutrientBar
                key={key}
                nutrient={key}
                value={averages[key]}
                daysSeen={daysWith[key]}
                dayCount={daysCovered}
                target={targets[key]}
                trend={trendPoints(window, key)}
                expanded={expanded === key}
                onToggle={() =>
                  setExpanded((cur) => (cur === key ? null : key))
                }
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            {trackedNames === 0
              ? "Log some meals to start tracking micronutrients."
              : enrichedNames === 0
                ? "Enrichment is in progress — your logged foods are being looked up on Open Food Facts. Check back shortly."
                : "None of your logged foods have micronutrient data on Open Food Facts yet. Branded / barcode-scanned foods enrich best."}
          </div>
        )}
      </div>
    </section>
  );
}

/** A single nutrient row: label, value/DV, and a bar filled to the
 *  percent of DV (capped at 100% so a sodium-heavy day doesn't blow
 *  the bar past the track). Renders a muted "no data" row when the
 *  nutrient has no value, so the panel always shows the full list
 *  and the gaps are explicit.
 *
 *  When the nutrient has at least two days of history, the whole row
 *  becomes a toggle that expands an inline trend chart below it —
 *  daily intake over the window with the Daily Value as a reference
 *  line. The average bar stays the primary, scannable view; the trend
 *  is on-demand so the panel isn't ten charts tall by default. */
function NutrientBar({
  nutrient,
  value,
  daysSeen,
  dayCount,
  target,
  trend,
  expanded,
  onToggle,
}: {
  nutrient: MicronutrientKey;
  value: number | undefined;
  /** How many of the window's tracked days carried this nutrient — the
   *  average is the mean over THOSE days, so partial coverage must be
   *  visible or a 2-of-20-days nutrient reads like a daily habit. */
  daysSeen: number | undefined;
  dayCount: number;
  target: number;
  trend: LinePoint[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = MICRONUTRIENTS[nutrient];
  const hasValue = typeof value === "number";
  const pct = hasValue ? Math.min(Math.round((value / target) * 100), 100) : 0;
  const color = `hsl(var(${meta.cssVar}))`;
  // A single point isn't a trend; only offer expansion with ≥2 days.
  const canExpand = trend.length >= 2;

  const summary = (
    <>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          {meta.label}
          {canExpand && (
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground/60 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          )}
        </span>
        {hasValue ? (
          <span className="font-mono tabular-nums text-muted-foreground">
            {formatValue(value)} {meta.unit}
            <span className="ml-1.5 text-muted-foreground/70">
              {Math.round((value / target) * 100)}% target
            </span>
            {/* Partial coverage caveat: the mean only spans the days this
                nutrient had data, so say so when that's not every day. */}
            {typeof daysSeen === "number" &&
              dayCount > 1 &&
              daysSeen < dayCount && (
                <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                  {daysSeen}/{dayCount} days
                </span>
              )}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground/60">
            no data
          </span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </>
  );

  return (
    <li>
      {canExpand ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {summary}
        </button>
      ) : (
        summary
      )}
      {expanded && canExpand && (
        <div className="mt-3">
          <ChartZoomDialog
            title={`${meta.label} — daily intake`}
            description="Each point is one logged day. The dashed line is your daily target."
          >
            <MiniLineChart
              data={trend}
              height={180}
              yUnit={` ${meta.unit}`}
              yIncludeZero
              targetY={target}
              targetLabel={`Target ${target} ${meta.unit}`}
            />
          </ChartZoomDialog>
        </div>
      )}
    </li>
  );
}

/** Build a per-day `LinePoint[]` for one nutrient from the window —
 *  one point per day that carried the nutrient, x as a unix-day index
 *  (so spacing reflects real gaps between logged days), oldest first. */
function trendPoints(
  window: MicronutrientDay[],
  nutrient: MicronutrientKey,
): LinePoint[] {
  const points: LinePoint[] = [];
  for (const day of window) {
    const v = day.totals[nutrient];
    if (typeof v === "number") {
      points.push({ x: dayIndex(day.date), y: v, label: shortLabel(day.date) });
    }
  }
  return points;
}

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

/** Upgrade prompt shown to free / plus users in place of the data. */
function MicronutrientsUpgradeCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight">Micronutrients</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Track vitamins, minerals &amp; fiber against daily targets — and
          export a report for yourself or a medical advisor.
        </p>
      </header>
      <div className="flex flex-col items-start gap-3 px-5 py-4">
        <p className="text-xs text-muted-foreground">
          Micronutrient tracking is a Pro feature. Your logged foods are
          enriched from Open Food Facts in the background, then charted here and
          in a printable report.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Upgrade to Pro
        </button>
      </div>
      <UpgradeDialog
        open={open}
        onOpenChange={setOpen}
        reason="settings"
        defaultPlan="pro"
      />
    </section>
  );
}

/** Round for display: drop decimals on values ≥ 10 (µg vitamins read
 *  cleaner as integers), keep one decimal below that. */
function formatValue(v: number): string {
  return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

/** Map the profile's gender to the biological sex the DRI table keys
 *  on. `nonbinary` / `preferNotToSay` / missing → `unspecified`, which
 *  the resolver answers with the flat FDA Daily Values. */
function sexFromGender(
  gender: PersonalInfo["gender"] | undefined,
): BiologicalSex {
  return gender === "male" || gender === "female" ? gender : "unspecified";
}

/** Count the distinct food names logged up to today — used to
 *  distinguish "you haven't logged anything" from "logged but not
 *  enriched yet" in the empty state. */
function countTrackedFoodNames(logs: DailyLog[], today: string): number {
  const names = new Set<string>();
  for (const log of logs) {
    if (log.date > today) continue;
    for (const meal of log.meals) {
      for (const food of meal.foods) {
        const key = foodNameKey(food.name);
        if (key) names.add(key);
      }
    }
  }
  return names.size;
}
