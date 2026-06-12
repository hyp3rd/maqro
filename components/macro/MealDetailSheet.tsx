"use client";

import { UpgradeDialog } from "@/components/macro/UpgradeDialog";
import type {
  MacroBreakdown,
  Meal,
  PersonalInfo,
} from "@/components/macro/types";
import { useAiUsage } from "@/hooks/use-ai-usage";
import { effectiveAge } from "@/lib/age";
import { clientFetch } from "@/lib/auth/client-fetch";
import { FEATURES } from "@/lib/billing/tiers";
import { getProfile, listMicronutrientProfiles } from "@/lib/db";
import { computeMealInsights, type MealInsight } from "@/lib/meal-insights";
import {
  aggregateMicronutrients,
  aggregateBreakdownWithProfiles,
  resolveMealFiber,
} from "@/lib/micronutrients/aggregate";
import type { MicronutrientProfile } from "@/lib/micronutrients/types";
import {
  getMicronutrientTargets,
  MICRONUTRIENT_KEYS,
  MICRONUTRIENTS,
  type BiologicalSex,
  type MicronutrientKey,
} from "@/lib/rda";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  Sparkles,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";

export type DailyGoal = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

const ADVICE_CONSENT_KEY = "maqro:meal-advice-consent";

function sexFromGender(g: PersonalInfo["gender"] | undefined): BiologicalSex {
  return g === "male" || g === "female" ? g : "unspecified";
}

/** The body of the per-meal view: macro breakdown, deterministic
 *  insights, micronutrients (Pro), and the AI "next time" advice (Pro).
 *  Header-less — the host (MealHubSheet) renders the meal title — and
 *  keyed by meal id at the call site so it remounts (fresh data) per open. */
export function MealDetail({ meal, goal }: { meal: Meal; goal?: DailyGoal }) {
  const { state } = useAiUsage();
  const isPro =
    state.status === "ok" && FEATURES.canTrackMicronutrients(state.data.tier);
  const tierResolved = state.status === "ok" || state.status === "anon";

  const [profiles, setProfiles] = useState<MicronutrientProfile[] | null>(null);
  const [userProfile, setUserProfile] = useState<PersonalInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await getProfile().catch(() => null);
      if (!cancelled) setUserProfile(p);
      if (isPro) {
        const rows = await listMicronutrientProfiles().catch(() => []);
        if (!cancelled) setProfiles(rows);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPro]);

  // Meal macro totals (foods are pre-scaled to portion).
  const totals = useMemo(
    () =>
      meal.foods.reduce(
        (a, f) => ({
          calories: a.calories + f.calories,
          protein: a.protein + f.protein,
          carbs: a.carbs + f.carbs,
          fat: a.fat + f.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [meal],
  );
  // One profile map for everything below. Loads as [] for free users —
  // the resolvers still read each food's own captured data.
  const profileMap = useMemo(
    () => new Map((profiles ?? []).map((p) => [p.nameKey, p])),
    [profiles],
  );

  // Sub-macros resolved per food with the profile-backed fallback — the
  // SAME chain the day totals use (aggregateBreakdownWithProfiles), so the
  // meal sheet and the dashboard can't disagree on the same data. Foods
  // logged without OFF data pick up the enrichment cron's backfill.
  const breakdown = useMemo(
    () => aggregateBreakdownWithProfiles([meal], profileMap),
    [meal, profileMap],
  );
  const { saturatedFat, addedSugars, sugars } = breakdown;

  // Fiber resolved per food across BOTH stores (product micros → name
  // profile → macro-side scaled value), so the breakdown line, the fiber
  // insight, and the micronutrient panel can't contradict each other.
  const { grams: fiber, knownCalorieShare: fiberCoverage } = useMemo(
    () => resolveMealFiber(meal, profileMap),
    [meal, profileMap],
  );

  const targets = useMemo(
    () =>
      getMicronutrientTargets(
        sexFromGender(userProfile?.gender),
        userProfile ? effectiveAge(userProfile) : 30,
      ),
    [userProfile],
  );

  // Per-meal micronutrient totals (Pro). Foods carry their own per-100g
  // micros (from OFF); the name-keyed profile cache fills the rest.
  const micros = useMemo(() => {
    if (!isPro || !profiles) return undefined;
    return aggregateMicronutrients([meal], profileMap);
  }, [isPro, profiles, profileMap, meal]);

  const insights = useMemo(
    () =>
      computeMealInsights({
        calories: totals.calories,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
        fiber,
        fiberKnownCalorieShare: fiberCoverage,
        saturatedFat,
        addedSugars,
        micros: micros,
        microTargets: micros ? targets : undefined,
        goal: goal && goal.calories > 0 ? goal : undefined,
      }),
    [
      totals,
      fiber,
      fiberCoverage,
      saturatedFat,
      addedSugars,
      micros,
      targets,
      goal,
    ],
  );

  const microRows = useMemo(() => {
    if (!micros) return [];
    return MICRONUTRIENT_KEYS.flatMap((key) => {
      const value = micros[key];
      if (typeof value !== "number") return [];
      return [{ key, value, target: targets[key] }];
    });
  }, [micros, targets]);

  // Macro calorie shares for the stacked bar.
  const pk = totals.protein * 4;
  const ck = totals.carbs * 4;
  const fk = totals.fat * 9;
  const kcalFromMacros = Math.max(1, pk + ck + fk);

  return (
    <>
      {/* --- Macro breakdown (free) --- */}
      <section className="space-y-2 pt-1">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <span
            style={{
              width: `${(pk / kcalFromMacros) * 100}%`,
              backgroundColor: "hsl(var(--macro-protein))",
            }}
          />
          <span
            style={{
              width: `${(ck / kcalFromMacros) * 100}%`,
              backgroundColor: "hsl(var(--macro-carbs))",
            }}
          />
          <span
            style={{
              width: `${(fk / kcalFromMacros) * 100}%`,
              backgroundColor: "hsl(var(--macro-fat))",
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <MacroCell
            label="Protein"
            grams={totals.protein}
            cssVar="--macro-protein"
          />
          <MacroCell
            label="Carbs"
            grams={totals.carbs}
            cssVar="--macro-carbs"
          />
          <MacroCell
            label="Fat"
            grams={totals.fat}
            cssVar="--macro-fat"
          />
        </div>
        {(fiber !== undefined ||
          sugars !== undefined ||
          addedSugars !== undefined ||
          saturatedFat !== undefined) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {fiber !== undefined && <span>Fiber {fiber}g</span>}
            {sugars !== undefined && <span>Sugars {sugars}g</span>}
            {addedSugars !== undefined && (
              <span>Added sugar {addedSugars}g</span>
            )}
            {saturatedFat !== undefined && <span>Sat fat {saturatedFat}g</span>}
          </div>
        )}
        {goal && goal.calories > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
            <span>
              <span className="font-mono tabular-nums text-foreground">
                {Math.round((totals.calories / goal.calories) * 100)}%
              </span>{" "}
              of daily calories
            </span>
            {goal.protein > 0 && (
              <span>
                <span className="font-mono tabular-nums text-foreground">
                  {Math.round((totals.protein / goal.protein) * 100)}%
                </span>{" "}
                of protein goal
              </span>
            )}
          </div>
        )}
      </section>

      {/* --- Insights (free macro flags; micro flags Pro) --- */}
      {insights.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Insights
          </h3>
          <ul className="space-y-1.5">
            {insights.map((ins, i) => (
              <InsightRow
                key={`${ins.title}-${i}`}
                insight={ins}
              />
            ))}
          </ul>
        </section>
      )}

      {/* --- Micronutrients (Pro) --- */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Micronutrients
          {!isPro && tierResolved && <ProBadge />}
        </h3>
        {!tierResolved ? (
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
        ) : !isPro ? (
          <ProUpsell reason="micros" />
        ) : profiles === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-3 w-full animate-pulse rounded bg-muted"
              />
            ))}
          </div>
        ) : microRows.length === 0 ? (
          <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            None of this meal&apos;s foods have micronutrient data yet. Branded
            / barcode-scanned foods enrich best.
          </p>
        ) : (
          <ul className="space-y-2">
            {microRows.map(({ key, value, target }) => (
              <MicroBar
                key={key}
                nutrient={key}
                value={value}
                target={target}
              />
            ))}
          </ul>
        )}
      </section>

      {/* --- Suggestions for next time (Pro) --- */}
      {tierResolved &&
        (isPro ? (
          <AiAdvice
            meal={meal}
            fiberGrams={fiber}
            breakdown={breakdown}
            insights={insights}
            micros={micros}
            targets={targets}
          />
        ) : (
          <section className="space-y-2 border-t border-border/60 pt-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Suggestions for next time
              <ProBadge />
            </h3>
            <ProUpsell reason="ai" />
          </section>
        ))}
    </>
  );
}

function MacroCell({
  label,
  grams,
  cssVar,
}: {
  label: string;
  grams: number;
  cssVar: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card py-2">
      <p
        className="font-mono text-base font-semibold tabular-nums"
        style={{ color: `hsl(var(${cssVar}))` }}
      >
        {Math.round(grams)}g
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function InsightRow({ insight }: { insight: MealInsight }) {
  const Icon =
    insight.tone === "warn"
      ? AlertTriangle
      : insight.tone === "good"
        ? CheckCircle2
        : Info;
  const color =
    insight.tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : insight.tone === "good"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  return (
    <li className="flex items-start gap-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-foreground">{insight.title}</span>
        <span className="text-muted-foreground"> — {insight.detail}</span>
      </span>
    </li>
  );
}

function MicroBar({
  nutrient,
  value,
  target,
}: {
  nutrient: MicronutrientKey;
  value: number;
  target: number;
}) {
  const meta = MICRONUTRIENTS[nutrient];
  const rawPct = (value / target) * 100;
  const pct = Math.min(Math.round(rawPct), 100);
  const display = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{meta.label}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {display} {meta.unit}
          <span className="ml-1.5 text-muted-foreground/70">
            {Math.round(rawPct)}% of daily
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
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
}

function ProBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-foreground">
      <Lock className="h-2.5 w-2.5" />
      Pro
    </span>
  );
}

function ProUpsell({ reason }: { reason: "micros" | "ai" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">
        {reason === "micros"
          ? "Track vitamins, minerals & fiber per meal with Pro."
          : "Get AI suggestions to rebalance this meal with Pro."}
      </p>
      <Button
        type="button"
        size="sm"
        className="h-8 shrink-0 gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Upgrade
      </Button>
      <UpgradeDialog
        open={open}
        onOpenChange={setOpen}
        reason="settings"
        defaultPlan="pro"
      />
    </div>
  );
}

type AdviceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; advice: string }
  | { status: "error"; message: string };

function AiAdvice({
  meal,
  fiberGrams,
  breakdown,
  insights,
  micros,
  targets,
}: {
  meal: Meal;
  /** Fiber resolved across both stores by the parent (`resolveMealFiber`)
   *  — keeps the AI's input consistent with the rendered insight. */
  fiberGrams: number | undefined;
  /** Profile-backed sub-macro totals from the parent — same values the
   *  sheet renders, so the AI reasons over what the user sees. */
  breakdown: MacroBreakdown;
  insights: MealInsight[];
  micros: ReturnType<typeof aggregateMicronutrients> | undefined;
  targets: Record<MicronutrientKey, number>;
}) {
  const [state, setState] = useState<AdviceState>({ status: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);

  const totals = meal.foods.reduce(
    (a, f) => ({
      calories: a.calories + f.calories,
      protein: a.protein + f.protein,
      carbs: a.carbs + f.carbs,
      fat: a.fat + f.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  async function getAdvice() {
    setState({ status: "loading" });
    const microPctOfTarget: Record<string, number> = {};
    if (micros) {
      for (const key of MICRONUTRIENT_KEYS) {
        const v = micros[key];
        const t = targets[key];
        if (typeof v === "number" && t) {
          microPctOfTarget[key] = (v / t) * 100;
        }
      }
    }
    try {
      const res = await clientFetch("/api/meal-insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meal: {
            name: meal.name,
            calories: totals.calories,
            protein: totals.protein,
            carbs: totals.carbs,
            fat: totals.fat,
            fiber: fiberGrams,
            saturatedFat: breakdown.saturatedFat,
            addedSugars: breakdown.addedSugars,
            foods: meal.foods.map((f) => ({
              name: f.name,
              grams: f.portionSize,
            })),
            microPctOfTarget: Object.keys(microPctOfTarget).length
              ? microPctOfTarget
              : undefined,
          },
          flags: insights.map((i) => i.title),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          kind?: string;
        };
        if (data.kind === "ai-cap-reached") {
          setState({
            status: "error",
            message: "You've used this month's request allowance.",
          });
        } else {
          setState({
            status: "error",
            message: data.error ?? "Couldn't get advice. Try again.",
          });
        }
        return;
      }
      const { advice } = (await res.json()) as { advice: string };
      setState({ status: "done", advice });
    } catch {
      setState({ status: "error", message: "Couldn't reach the service." });
    }
  }

  // Gate the first request behind a one-line consent ("this uses a
  // monthly request"). "Don't ask again" remembers the choice so it's a
  // one-time speed bump, not a nag.
  function start() {
    let remembered = false;
    try {
      remembered = localStorage.getItem(ADVICE_CONSENT_KEY) === "1";
    } catch {
      remembered = false;
    }
    if (remembered) void getAdvice();
    else setConfirmOpen(true);
  }
  function confirmProceed() {
    if (dontAsk) {
      try {
        localStorage.setItem(ADVICE_CONSENT_KEY, "1");
      } catch {
        /* localStorage may be unavailable — proceed without remembering */
      }
    }
    setConfirmOpen(false);
    void getAdvice();
  }

  return (
    <section className="space-y-2 border-t border-border/60 pt-3">
      {state.status === "done" ? (
        <div className="space-y-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Suggestions for next time
          </h3>
          <div className="space-y-1 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 text-sm text-foreground">
            {state.advice
              .split("\n")
              .map((line, i) =>
                line.trim() ? (
                  <p key={i}>{line.replace(/^[-•]\s*/, "")}</p>
                ) : null,
              )}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            General guidance, not medical advice — double-check anything
            important and adapt it to any medical condition, allergy, or dietary
            need.
          </p>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full gap-1.5"
            disabled={state.status === "loading"}
            onClick={start}
          >
            {state.status === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {state.status === "loading"
              ? "Thinking…"
              : "Suggest tweaks for next time"}
          </Button>
          {state.status === "error" && (
            <p className="text-center text-xs text-destructive">
              {state.message}
            </p>
          )}
        </>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Personalized suggestions</AlertDialogTitle>
            <AlertDialogDescription>
              This generates tailored tips for this meal and uses one of your
              monthly requests.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <Checkbox
              checked={dontAsk}
              onCheckedChange={(v) => setDontAsk(v === true)}
            />
            Don&apos;t ask again
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={confirmProceed}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
