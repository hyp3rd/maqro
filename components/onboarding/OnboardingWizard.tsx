"use client";

import type {
  DietPreference,
  Gender,
  PersonalInfo,
} from "@/components/macro/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emitOnboardingEvent } from "@/lib/telemetry/onboarding";
import {
  cmToFeetInches,
  displayToKg,
  feetInchesToCm,
  kgToDisplay,
} from "@/lib/units";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

/** First-run onboarding wizard. Four steps:
 *
 *    1. Welcome - name the product + the value prop in one screen.
 *    2. Basics - sex (Mifflin–St Jeor needs it), age, weight, height.
 *    3. Activity + goal - activity level, lose/maintain/gain, weekly rate.
 *    4. Diet preference + done - diet kind, optional cuisine teaser.
 *
 *  Each step is a focused screen with a single decision so a brand-new
 *  user can finish in under a minute. "Skip onboarding" jumps the
 *  wizard but leaves the dismissal flag set so the user doesn't see it
 *  again on the next load. Saved profile values come back through the
 *  caller's `onFinish` callback, which decides whether to call
 *  `setProfile` and persist locally / sync. */
type Props = {
  open: boolean;
  /** Current profile (used to pre-fill if the user is partway
   *  through onboarding on a fresh device - sync may have brought
   *  *some* values down). */
  initial: PersonalInfo;
  /** Fires when the user completes or skips the wizard. The caller
   *  persists `profile` (when present) and marks onboarding complete. */
  onFinish: (result: {
    profile: PersonalInfo | null;
    skipped: boolean;
  }) => void;
};

const TOTAL_STEPS = 4;

const ACTIVITY_LABELS: Record<PersonalInfo["activityLevel"], string> = {
  sedentary: "Sedentary - desk job, little exercise",
  light: "Light - 1–3 workouts / week",
  moderate: "Moderate - 3–5 workouts / week",
  active: "Active - 6–7 workouts / week",
  veryActive: "Very active - daily training + physical job",
};

const GOAL_LABELS: Record<PersonalInfo["goal"], string> = {
  lose: "Lose weight",
  maintain: "Maintain weight",
  gain: "Gain weight",
};

const DIET_LABELS: Record<DietPreference, string> = {
  omnivore: "Omnivore - eat everything",
  vegetarian: "Vegetarian - no meat / fish",
  vegan: "Vegan - no animal products",
  pescatarian: "Pescatarian - no land meat",
  carnivore: "Carnivore - meat / fish / eggs / dairy",
};

const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  nonbinary: "Non-binary",
  preferNotToSay: "Prefer not to say",
};

export function OnboardingWizard({ open, initial, onFinish }: Props) {
  // We do nothing if the dialog isn't open - keeps the form state
  // ephemeral and re-mounts cleanly on re-open.
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Closing via overlay / escape is treated as "skip" so the
        // user isn't trapped. Parent decides whether to record the
        // dismissal as completed onboarding.
        if (!o) {
          // We don't know which step the user dismissed from at this
          // layer (the inner WizardBody owns `step`). Bucket it as
          // step 0 - the dismissal-via-overlay path is an "escape
          // from the whole wizard" signal, not a per-step one. The
          // Skip button below DOES know its step and reports it.
          emitOnboardingEvent({ step: 0, action: "skip" });
          onFinish({ profile: null, skipped: true });
        }
      }}
    >
      <DialogContent>
        {open && (
          <WizardBody
            initial={initial}
            onFinish={onFinish}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function WizardBody({
  initial,
  onFinish,
}: {
  initial: PersonalInfo;
  onFinish: (result: {
    profile: PersonalInfo | null;
    skipped: boolean;
  }) => void;
}) {
  // Working copy of the profile. Each step mutates whichever fields
  // it owns. The final step's "Get started" hands the full object
  // back to the parent.
  const [draft, setDraft] = useState<PersonalInfo>(initial);
  const [step, setStep] = useState(0);

  // Funnel-counter wiring. The aggregate-only telemetry fires
  // exactly one 'enter' event per step visit (covering both the
  // first-mount and subsequent next/back transitions), plus a
  // terminal 'skip' or 'finish'. The route's response is ignored -
  // the wizard never blocks on it. See lib/telemetry/onboarding.ts
  // for the privacy rationale.
  useEffect(() => {
    emitOnboardingEvent({ step, action: "enter" });
  }, [step]);

  const next = () => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  function patch<K extends keyof PersonalInfo>(key: K, value: PersonalInfo[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Welcome to Maqro
        </DialogTitle>
        <DialogDescription>
          Step {step + 1} of {TOTAL_STEPS} - takes about a minute. You can edit
          any of this later from the Calculator tab.
        </DialogDescription>
      </DialogHeader>

      {/* Step progress bar - thin, visual only. The header carries the
          numeric "Step X of N" announcement for screen readers. */}
      <div
        className="h-0.5 w-full overflow-hidden rounded-full bg-muted"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
          style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
        />
      </div>

      <div className="min-h-[18rem] py-2">
        {step === 0 && <StepWelcome />}
        {step === 1 && (
          <StepBasics
            draft={draft}
            patch={patch}
          />
        )}
        {step === 2 && (
          <StepActivityGoal
            draft={draft}
            patch={patch}
          />
        )}
        {step === 3 && (
          <StepDiet
            draft={draft}
            patch={patch}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            emitOnboardingEvent({ step, action: "skip" });
            onFinish({ profile: null, skipped: true });
          }}
          className="text-muted-foreground"
        >
          Skip
        </Button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={back}
              className="gap-1.5"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          )}
          {step < TOTAL_STEPS - 1 ? (
            <Button
              type="button"
              size="sm"
              onClick={next}
              className="gap-1.5"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                emitOnboardingEvent({ step, action: "finish" });
                onFinish({ profile: draft, skipped: false });
              }}
              className="gap-1.5"
            >
              Get started
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function StepWelcome() {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-foreground">
        Maqro is a private macro calculator + meal planner. It runs on your
        device, syncs across signed-in devices, and never tries to sell your
        data.
      </p>
      <p className="text-sm leading-relaxed text-foreground">
        In four quick steps we&apos;ll set up your profile so the daily targets
        and the AI meal planner know who they&apos;re planning for. Nothing here
        is irreversible - every value lives on the{" "}
        <span className="font-medium">Calculator</span> tab and is editable any
        time.
      </p>
      <ul className="space-y-1 text-sm text-muted-foreground">
        <li>• Basics - age, sex, weight, height</li>
        <li>• Activity level + your goal (lose / maintain / gain)</li>
        <li>• Diet preference (omnivore, vegetarian, etc.)</li>
      </ul>
    </div>
  );
}

function StepBasics({
  draft,
  patch,
}: {
  draft: PersonalInfo;
  patch: <K extends keyof PersonalInfo>(key: K, value: PersonalInfo[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        These feed the Mifflin–St Jeor BMR formula. Estimates run 10–20% off for
        any individual - you can calibrate against measured TDEE on the
        Calculator tab once you have a few weeks of data.
      </p>

      {/* Unit toggle. Auto-seeded from `navigator.language` by
       *  `useProfile`, but exposed here so the user can flip it
       *  immediately if the guess was wrong — without hunting
       *  through Settings on first run. The fields below re-render
       *  in the chosen system as soon as it changes. */}
      <ObUnitsToggle
        units={draft.units}
        onChange={(next) => patch("units", next)}
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="ob-gender">Sex (for BMR formula)</Label>
          <Select
            value={draft.gender}
            onValueChange={(v) => patch("gender", v as Gender)}
          >
            <SelectTrigger id="ob-gender">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
                <SelectItem
                  key={g}
                  value={g}
                >
                  {GENDER_LABELS[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-age">Age (years)</Label>
          <Input
            id="ob-age"
            type="number"
            inputMode="numeric"
            value={draft.age || ""}
            onChange={(e) =>
              patch("age", Number.parseInt(e.target.value, 10) || 0)
            }
            min={10}
            max={120}
          />
        </div>
        <ObWeightInput
          draft={draft}
          patch={patch}
        />
        <ObHeightInput
          draft={draft}
          patch={patch}
        />
      </div>
    </div>
  );
}

function StepActivityGoal({
  draft,
  patch,
}: {
  draft: PersonalInfo;
  patch: <K extends keyof PersonalInfo>(key: K, value: PersonalInfo[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ob-activity">How active are you?</Label>
        <Select
          value={draft.activityLevel}
          onValueChange={(v) =>
            patch("activityLevel", v as PersonalInfo["activityLevel"])
          }
        >
          <SelectTrigger id="ob-activity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.keys(ACTIVITY_LABELS) as PersonalInfo["activityLevel"][]
            ).map((a) => (
              <SelectItem
                key={a}
                value={a}
              >
                {ACTIVITY_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ob-goal">Goal</Label>
        <Select
          value={draft.goal}
          onValueChange={(v) => patch("goal", v as PersonalInfo["goal"])}
        >
          <SelectTrigger id="ob-goal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GOAL_LABELS) as PersonalInfo["goal"][]).map((g) => (
              <SelectItem
                key={g}
                value={g}
              >
                {GOAL_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {draft.goal !== "maintain" && (
        <div className="space-y-1.5">
          <Label htmlFor="ob-rate">
            Pace ({draft.goal === "lose" ? "lose" : "gain"} kg / week)
          </Label>
          <Input
            id="ob-rate"
            type="number"
            inputMode="decimal"
            value={draft.weeklyRateKg || ""}
            onChange={(e) =>
              patch("weeklyRateKg", Number.parseFloat(e.target.value) || 0)
            }
            min={0.1}
            max={1.5}
            step={0.1}
          />
          <p className="text-[11px] text-muted-foreground">
            0.3–0.7 kg / week is sustainable for most people. Faster paces are
            harder to maintain and risk muscle loss; the Calculator caps how
            aggressive a deficit can get to keep you above a safe minimum.
          </p>
        </div>
      )}
    </div>
  );
}

function StepDiet({
  draft,
  patch,
}: {
  draft: PersonalInfo;
  patch: <K extends keyof PersonalInfo>(key: K, value: PersonalInfo[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        The AI meal planner respects this when picking foods. You can also list
        allergies and disliked foods on the Calculator tab - those settings live
        in the same form and feed the same prompt.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="ob-diet">Diet preference</Label>
        <Select
          value={draft.dietPreference}
          onValueChange={(v) => patch("dietPreference", v as DietPreference)}
        >
          <SelectTrigger id="ob-diet">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DIET_LABELS) as DietPreference[]).map((d) => (
              <SelectItem
                key={d}
                value={d}
              >
                {DIET_LABELS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-md border border-dashed border-border/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Almost done.</span> Click{" "}
        <strong>Get started</strong> and we&apos;ll save your profile.
        Allergies, dislikes, and cuisine preferences live on the Calculator tab
        - those are optional and can be filled in later.
      </div>
    </div>
  );
}

/** Onboarding unit-system toggle. A pair of radio-styled buttons
 *  sized for the wizard step. We expose it inside the Basics step
 *  rather than as a wizard preamble because the user has to interact
 *  with weight + height on this same screen — putting the toggle
 *  right above them is the natural place to flip it if the locale
 *  auto-detect was wrong. */
function ObUnitsToggle({
  units,
  onChange,
}: {
  units: PersonalInfo["units"];
  onChange: (next: PersonalInfo["units"]) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Display unit system"
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5 text-xs"
    >
      <ObUnitButton
        active={units === "metric"}
        onClick={() => onChange("metric")}
        label="Metric"
        sub="kg / cm"
      />
      <ObUnitButton
        active={units === "imperial"}
        onClick={() => onChange("imperial")}
        label="Imperial"
        sub="lb / ft·in"
      />
    </div>
  );
}

function ObUnitButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`inline-flex flex-col items-center gap-0 rounded px-3 py-1 transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span className="text-[11px] font-medium">{label}</span>
      <span className="text-[9px] opacity-70">{sub}</span>
    </button>
  );
}

/** Onboarding weight input. Storage is kg; UI flips kg ↔ lb based
 *  on the user's `units` preference (which `useProfile` has already
 *  seeded from `navigator.language` for first-time US visitors). */
function ObWeightInput({
  draft,
  patch,
}: {
  draft: PersonalInfo;
  patch: <K extends keyof PersonalInfo>(key: K, value: PersonalInfo[K]) => void;
}) {
  const units = draft.units;
  const unitLabel = units === "imperial" ? "lb" : "kg";
  const value = draft.weight ? kgToDisplay(draft.weight, units) : "";
  const min = units === "imperial" ? 44 : 20;
  const max = units === "imperial" ? 660 : 300;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="ob-weight">Weight ({unitLabel})</Label>
      <Input
        id="ob-weight"
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          patch(
            "weight",
            Number.isNaN(parsed) ? 0 : displayToKg(parsed, units),
          );
        }}
        min={min}
        max={max}
        step={0.1}
      />
    </div>
  );
}

/** Onboarding height input. Metric is one cm field; imperial is a
 *  pair of feet + inches fields. Both modes store cm. */
function ObHeightInput({
  draft,
  patch,
}: {
  draft: PersonalInfo;
  patch: <K extends keyof PersonalInfo>(key: K, value: PersonalInfo[K]) => void;
}) {
  if (draft.units === "imperial") {
    const { feet, inches } = draft.height
      ? cmToFeetInches(draft.height)
      : { feet: 0, inches: 0 };
    return (
      <div className="col-span-2 space-y-1.5">
        <Label htmlFor="ob-height-ft">Height (ft / in)</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            id="ob-height-ft"
            type="number"
            inputMode="numeric"
            value={feet || ""}
            onChange={(e) => {
              const f = Number.parseInt(e.target.value, 10);
              patch("height", Number.isNaN(f) ? 0 : feetInchesToCm(f, inches));
            }}
            min={3}
            max={8}
            aria-label="Height — feet"
          />
          <Input
            id="ob-height-in"
            type="number"
            inputMode="numeric"
            value={inches || ""}
            onChange={(e) => {
              const i = Number.parseInt(e.target.value, 10);
              patch(
                "height",
                Number.isNaN(i)
                  ? 0
                  : feetInchesToCm(feet, Math.min(Math.max(i, 0), 11)),
              );
            }}
            min={0}
            max={11}
            aria-label="Height — inches"
          />
        </div>
      </div>
    );
  }
  return (
    <div className="col-span-2 space-y-1.5">
      <Label htmlFor="ob-height">Height (cm)</Label>
      <Input
        id="ob-height"
        type="number"
        inputMode="numeric"
        value={draft.height || ""}
        onChange={(e) =>
          patch("height", Number.parseInt(e.target.value, 10) || 0)
        }
        min={80}
        max={250}
      />
    </div>
  );
}
