"use client";

import { UpgradeDialog } from "@/components/macro/UpgradeDialog";
import { useAiUsage } from "@/hooks/use-ai-usage";
import { FEATURES } from "@/lib/billing/tiers";
import {
  activePhase,
  newPhase,
  normalizePhase,
  phaseEndDate,
  PHASE_KINDS,
  PHASE_LABELS,
  phaseHasRate,
  presetCut,
  presetCutThenBreak,
  presetLeanBulk,
  sortPhases,
} from "@/lib/goal-phases";
import {
  displayToKg,
  formatWeightRate,
  kgToDisplay,
  type UnitSystem,
} from "@/lib/units";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Pencil, Plus, Sparkles, Target, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { GoalPhase, GoalPhaseKind, PersonalInfo } from "./types";

const GOAL_LABEL: Record<PersonalInfo["goal"], string> = {
  lose: "Lose",
  maintain: "Maintain",
  gain: "Gain",
};

const INPUT_CLASS =
  "mt-1 h-8 w-full rounded-md border border-border/60 bg-card px-2 text-sm text-foreground";

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Signed rate text for a phase ("cut" reads as a loss, "leanBulk" a gain). */
function rateText(phase: GoalPhase, units: UnitSystem): string {
  return formatWeightRate(
    phase.kind === "cut" ? -phase.weeklyRateKg : phase.weeklyRateKg,
    units,
  );
}

/** Pro-gated goal-phase planner, rendered in the Calculator view. Free / Plus
 *  users see an upgrade prompt; Pro users build a sequence of phases (cut →
 *  diet break → maintenance → lean bulk) that drives the calorie target by
 *  date. Writes the array straight back through `onChange` (→ `patchProfile`),
 *  so it syncs like the rest of the profile. */
export function GoalPhasesPlanner({
  phases,
  onChange,
  weightKg,
  units,
  today,
  goal,
  targetForPhases,
}: {
  phases: GoalPhase[] | undefined;
  onChange: (phases: GoalPhase[]) => void;
  weightKg: number;
  units: UnitSystem;
  today: string;
  goal: PersonalInfo["goal"];
  /** Today's calorie target for a hypothetical phase list (the parent runs the
   *  real effectiveGoal → computeMacros pipeline). Powers the rise warning. */
  targetForPhases: (phases: GoalPhase[]) => number;
}) {
  const { state } = useAiUsage();
  const isPro =
    state.status === "ok" && FEATURES.canUseGoalPhases(state.data.tier);
  const tierResolved = state.status === "ok" || state.status === "anon";
  const [editing, setEditing] = useState<GoalPhase | null>(null);
  // A pending change held back for confirmation because it would raise today's
  // target while a cut is active (see `applyMaybeWarn`). `null` = no warning.
  const [pendingRaise, setPendingRaise] = useState<{
    phases: GoalPhase[];
    before: number;
    after: number;
  } | null>(null);

  if (!tierResolved) return null;
  if (!isPro) return <GoalPhasesUpgradeCard />;

  const list = sortPhases(phases ?? []);
  const active = activePhase(list, today);

  const normalizeAll = (next: GoalPhase[]) =>
    sortPhases(next.map((p) => normalizePhase(p, weightKg)));

  function commit(next: GoalPhase[]) {
    onChange(normalizeAll(next));
  }

  // Apply `next`, but first intercept the counterintuitive case: a change that
  // RAISES today's calorie target while a *cut* is the phase active today (e.g.
  // a gentler cut than your current deficit, so "starting a cut" reads as more
  // calories). Confirm before committing. Everything else — an intentional lean
  // bulk, a future phase, a delete — applies straight through.
  function applyMaybeWarn(next: GoalPhase[]) {
    const norm = normalizeAll(next);
    const before = targetForPhases(list);
    const after = targetForPhases(norm);
    if (after > before && activePhase(norm, today)?.kind === "cut") {
      setPendingRaise({ phases: norm, before, after });
    } else {
      onChange(norm);
    }
  }

  function upsert(phase: GoalPhase) {
    const norm = normalizePhase(phase, weightKg);
    applyMaybeWarn(
      list.some((p) => p.id === norm.id)
        ? list.map((p) => (p.id === norm.id ? norm : p))
        : [...list, norm],
    );
    setEditing(null);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Target className="h-4 w-4 text-brand" />
          Goal phases
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sequence a cut, diet break, maintenance, or lean bulk. The phase
          active today drives your target; when none is, your Goal (
          {GOAL_LABEL[goal]}) above is used.
        </p>
      </header>

      <div className="space-y-3 px-5 py-4">
        {list.length === 0 ? (
          <div className="space-y-2.5">
            <p className="text-xs text-muted-foreground">Quick-start a plan:</p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => applyMaybeWarn(presetCut(today, weightKg))}
              >
                Start a cut
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() =>
                  applyMaybeWarn(presetCutThenBreak(today, weightKg))
                }
              >
                12-wk cut → 2-wk break
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => applyMaybeWarn(presetLeanBulk(today, weightKg))}
              >
                Lean bulk
              </Button>
            </div>
            {!editing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-muted-foreground"
                onClick={() => setEditing(newPhase(list, today))}
              >
                <Plus className="h-3.5 w-3.5" />
                or build your own
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {list.map((phase) => {
                const isActive = active?.id === phase.id;
                return (
                  <li
                    key={phase.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2",
                      isActive
                        ? "border-brand/50 bg-brand/5"
                        : "border-border/60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {PHASE_LABELS[phase.kind]}
                        {isActive && (
                          <span className="rounded bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand">
                            active
                          </span>
                        )}
                      </span>
                      <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                        {fmtDate(phase.startDate)} →{" "}
                        {fmtDate(phaseEndDate(phase))} · {phase.durationWeeks}{" "}
                        wk
                        {phase.durationWeeks === 1 ? "" : "s"}
                        {phaseHasRate(phase.kind) &&
                          ` · ${rateText(phase, units)}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(phase)}
                      aria-label={`Edit ${PHASE_LABELS[phase.kind]} phase`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commit(list.filter((p) => p.id !== phase.id))
                      }
                      aria-label={`Remove ${PHASE_LABELS[phase.kind]} phase`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {!editing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setEditing(newPhase(list, today))}
              >
                <Plus className="h-3.5 w-3.5" />
                Add phase
              </Button>
            )}
          </>
        )}

        {editing && (
          <PhaseEditor
            phase={editing}
            weightKg={weightKg}
            units={units}
            onSave={upsert}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>

      <AlertDialog
        open={pendingRaise !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRaise(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This raises today&apos;s target</AlertDialogTitle>
            <AlertDialogDescription>
              Applying this sets today&apos;s target to{" "}
              <span className="font-medium text-foreground">
                {pendingRaise?.after.toLocaleString()} kcal
              </span>{" "}
              — up{" "}
              {pendingRaise
                ? (pendingRaise.after - pendingRaise.before).toLocaleString()
                : 0}{" "}
              kcal from your current{" "}
              <span className="font-medium text-foreground">
                {pendingRaise?.before.toLocaleString()} kcal
              </span>
              . A cut usually lowers calories — it&apos;s higher here because
              your current target already runs a steeper deficit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRaise) onChange(pendingRaise.phases);
                setPendingRaise(null);
              }}
            >
              Apply anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Inline add/edit form for a single phase. */
function PhaseEditor({
  phase,
  weightKg,
  units,
  onSave,
  onCancel,
}: {
  phase: GoalPhase;
  weightKg: number;
  units: UnitSystem;
  onSave: (phase: GoalPhase) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<GoalPhase>(phase);
  const showRate = phaseHasRate(draft.kind);
  const capKg = weightKg * 0.01;
  const unitLabel = units === "imperial" ? "lb" : "kg";

  return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-xs text-muted-foreground">
          Phase
          <Select
            value={draft.kind}
            onValueChange={(v) =>
              setDraft({ ...draft, kind: v as GoalPhaseKind })
            }
          >
            <SelectTrigger className="mt-1 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PHASE_KINDS.map((k) => (
                <SelectItem
                  key={k}
                  value={k}
                  className="text-sm"
                >
                  {PHASE_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="text-xs text-muted-foreground">
          Starts
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>

        <label className="text-xs text-muted-foreground">
          Weeks
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={52}
            value={draft.durationWeeks}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n)) setDraft({ ...draft, durationWeeks: n });
            }}
            className={cn(INPUT_CLASS, "font-mono tabular-nums")}
          />
        </label>

        {showRate && (
          <label className="text-xs text-muted-foreground">
            Rate ({unitLabel}/week)
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={kgToDisplay(capKg, units)}
              step={0.05}
              value={kgToDisplay(draft.weeklyRateKg, units)}
              onChange={(e) => {
                const v = Number.parseFloat(e.target.value);
                if (Number.isFinite(v))
                  setDraft({
                    ...draft,
                    weeklyRateKg: Math.min(displayToKg(v, units), capKg),
                  });
              }}
              className={cn(INPUT_CLASS, "font-mono tabular-nums")}
            />
          </label>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={() => onSave(draft)}
        >
          Save phase
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Free / Plus upsell shown in place of the planner. Mirrors
 *  `MicronutrientsUpgradeCard`. */
function GoalPhasesUpgradeCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Target className="h-4 w-4 text-brand" />
          Goal phases
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Plan a cut → diet break → maintenance → lean bulk and let your target
          shift automatically as each phase begins.
        </p>
      </header>
      <div className="flex flex-col items-start gap-3 px-5 py-4">
        <p className="text-xs text-muted-foreground">
          Goal phases is a Pro feature. Sequence your training year and the
          calorie + macro targets follow the active phase by date — with a
          gentle diet-break nudge after a long cut.
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
