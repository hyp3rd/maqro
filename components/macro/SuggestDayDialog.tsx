"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  requestDaySuggestion,
  type SuggestDayResult,
} from "@/lib/ai-suggest-day";
import { listRecipes } from "@/lib/db";
import { recipePerServingMacros } from "@/lib/recipe-ranking";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChefHat, Loader2, LogIn, RefreshCw, Sparkles } from "lucide-react";
import { UpgradeDialog } from "./UpgradeDialog";
import type { Meal, Recipe } from "./types";

type Macros = { protein: number; carbs: number; fat: number; calories: number };

type Pick = { slot: string; mealId: number; recipe: Recipe };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The user's meal slots (for names + slot→id resolution). */
  meals: readonly Meal[];
  /** Today's macro target. */
  target: Macros;
  /** Macros already logged today. */
  logged: Macros;
  /** Log all picks into their slots on today. */
  onApplyDay: (picks: { recipe: Recipe; mealId: number }[]) => void;
};

type ViewState =
  | { status: "loading" }
  | { status: "ok"; picks: Pick[]; note: string | null }
  | { status: "empty" }
  | { status: "cap"; used: number; cap: number }
  | { status: "auth" }
  | { status: "error"; message: string };

function resultToState(
  result: SuggestDayResult,
  recipes: Recipe[],
  meals: readonly Meal[],
): ViewState {
  if (result.kind === "cap-reached")
    return { status: "cap", used: result.used, cap: result.cap };
  if (result.kind === "not-authenticated") return { status: "auth" };
  if (result.kind === "not-configured")
    return { status: "error", message: "AI isn't available here." };
  if (result.kind === "rate-limited")
    return { status: "error", message: "AI is busy — try again shortly." };
  if (result.kind === "empty") return { status: "empty" };
  if (result.kind === "error")
    return { status: "error", message: result.message };

  const byId = new Map(recipes.map((r) => [r.id, r]));
  const byName = new Map(meals.map((m) => [m.name, m.id]));
  const picks: Pick[] = [];
  for (const a of result.assignments) {
    const recipe = byId.get(a.recipeId);
    const mealId = byName.get(a.slot);
    if (recipe && mealId !== undefined)
      picks.push({ slot: a.slot, mealId, recipe });
  }
  return picks.length === 0
    ? { status: "empty" }
    : { status: "ok", picks, note: result.note };
}

export function SuggestDayDialog({
  open,
  onOpenChange,
  meals,
  target,
  logged,
  onApplyDay,
}: Props) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const autoRan = useRef(false);

  // The parent mounts this fresh per open, so `target`/`logged`/`meals` here
  // are the day's current values. Suggest once on mount; Shuffle re-runs it.
  const suggest = useCallback(async () => {
    setState({ status: "loading" });
    let recipes: Recipe[];
    try {
      recipes = await listRecipes();
    } catch {
      setState({ status: "error", message: "Couldn't load your recipes." });
      return;
    }
    if (recipes.length === 0) {
      setState({ status: "empty" });
      return;
    }
    const remaining: Macros = {
      protein: Math.max(0, Math.round(target.protein - logged.protein)),
      carbs: Math.max(0, Math.round(target.carbs - logged.carbs)),
      fat: Math.max(0, Math.round(target.fat - logged.fat)),
      calories: Math.max(0, Math.round(target.calories - logged.calories)),
    };
    const result = await requestDaySuggestion({
      targets: remaining,
      mealSlots: meals.map((m) => m.name),
      recipes: recipes.map((r) => {
        const m = recipePerServingMacros(r);
        return {
          id: r.id,
          name: r.name,
          protein: m.protein,
          carbs: m.carbs,
          fat: m.fat,
          calories: m.calories,
          cuisine: r.cuisine,
        };
      }),
    });
    setState(resultToState(result, recipes, meals));
  }, [target, logged, meals]);

  // Guarded so the effect doesn't re-fire if `suggest`'s identity changes from
  // a parent re-render — it runs exactly once on mount.
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    void suggest();
  }, [suggest]);

  const combined =
    state.status === "ok"
      ? state.picks.reduce<Macros>(
          (acc, p) => {
            const m = recipePerServingMacros(p.recipe);
            return {
              protein: acc.protein + m.protein,
              carbs: acc.carbs + m.carbs,
              fat: acc.fat + m.fat,
              calories: acc.calories + m.calories,
            };
          },
          { protein: 0, carbs: 0, fat: 0, calories: 0 },
        )
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 leading-tight">
            <Sparkles className="h-4 w-4 text-primary" />
            Today&apos;s plan
          </DialogTitle>
          <DialogDescription>
            A day picked from your saved recipes to land near your remaining
            targets. Nothing is logged until you tap “Log this day.”
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-xs">Finding a day that fits…</p>
          </div>
        )}

        {state.status === "empty" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ChefHat className="h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">Not enough to go on yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              We couldn&apos;t build a full day from your saved recipes. Save a
              few more breakfast / lunch / dinner dishes and try again.
            </p>
          </div>
        )}

        {state.status === "cap" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles className="h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">Monthly AI limit reached</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              You&apos;ve used all your AI suggestions this month ({state.used}/
              {state.cap}). It resets on the 1st — or upgrade for more.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-2 gap-1.5"
              onClick={() => setUpgradeOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Upgrade
            </Button>
          </div>
        )}

        {state.status === "auth" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles className="h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm font-medium">Sign in to continue</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              AI day suggestions use your monthly allowance, which is tied to
              your account.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-2 gap-1.5"
              onClick={() =>
                window.location.assign(
                  `/login?next=${encodeURIComponent("/app")}`,
                )
              }
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in
            </Button>
          </div>
        )}

        {state.status === "error" && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-sm font-medium text-destructive">
              Couldn&apos;t suggest a day
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {state.message}
            </p>
          </div>
        )}

        {state.status === "ok" && combined && (
          <div className="space-y-3">
            <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card">
              {state.picks.map((p) => {
                const m = recipePerServingMacros(p.recipe);
                return (
                  <li
                    key={`${p.slot}-${p.recipe.id}`}
                    className="flex items-baseline justify-between gap-2 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {p.slot}
                      </p>
                      <p className="truncate text-sm font-medium">
                        {p.recipe.name}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {Math.round(m.calories)} kcal
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              Day total: {Math.round(combined.calories)} kcal · P
              {Math.round(combined.protein)} C{Math.round(combined.carbs)} F
              {Math.round(combined.fat)}
              <br />
              Target: {Math.round(target.calories)} kcal · P
              {Math.round(target.protein)} C{Math.round(target.carbs)} F
              {Math.round(target.fat)}
            </div>

            {state.note && (
              <p className="text-[11px] italic text-muted-foreground">
                {state.note}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {(state.status === "ok" ||
            state.status === "empty" ||
            state.status === "error") && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void suggest()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Shuffle
            </Button>
          )}
          {state.status === "ok" && (
            <Button
              type="button"
              onClick={() => {
                onApplyDay(
                  state.picks.map((p) => ({
                    recipe: p.recipe,
                    mealId: p.mealId,
                  })),
                );
                onOpenChange(false);
              }}
            >
              Log this day
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        reason="ai-cap"
        defaultPlan="plus"
      />
    </Dialog>
  );
}
