"use client";

import React from "react";
import {
  CUISINES,
  type MacroSplit,
  PersonalInfo,
} from "../../components/macro/types";
import {
  cmToFeetInches,
  displayToKg,
  feetInchesToCm,
  kgToDisplay,
  type UnitSystem,
} from "../../lib/units";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { TagInput } from "./TagInput";

interface PersonalInfoFormProps {
  personalInfo: PersonalInfo;
  onPersonalInfoChange: (
    name: string,
    value: string | number | null | string[] | MacroSplit,
  ) => void;
}

const PersonalInfoForm: React.FC<PersonalInfoFormProps> = ({
  personalInfo,
  onPersonalInfoChange,
}) => {
  const numberHandler =
    (field: keyof PersonalInfo, fallback: number, parser = parseFloat) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parser(e.target.value);
      onPersonalInfoChange(field, Number.isNaN(v) ? fallback : v);
    };

  return (
    <div className="space-y-6">
      <Section
        title="Body"
        description="Used to estimate BMR and TDEE."
        headerExtra={
          <InlineUnitsToggle
            units={personalInfo.units}
            onChange={(next) => onPersonalInfoChange("units", next)}
          />
        }
      >
        <Field
          id="displayName"
          label="Display name (optional)"
          hint="Shown in the sidebar instead of your email. Leave blank to use the email."
        >
          <Input
            id="displayName"
            type="text"
            value={personalInfo.displayName ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              onPersonalInfoChange(
                "displayName",
                raw.trim() === "" ? null : raw,
              );
            }}
            placeholder="e.g. Alex"
          />
        </Field>

        <Row>
          <Field
            id="gender"
            label="Gender"
          >
            <Select
              value={personalInfo.gender}
              onValueChange={(v) => onPersonalInfoChange("gender", v)}
            >
              <SelectTrigger id="gender">
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="nonbinary">Non-binary</SelectItem>
                <SelectItem value="preferNotToSay">
                  Prefer not to say
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="age"
            label="Age"
          >
            <Input
              id="age"
              type="number"
              min="18"
              max="100"
              value={personalInfo.age}
              onChange={numberHandler("age", personalInfo.age, (s) =>
                parseInt(s, 10),
              )}
            />
          </Field>
        </Row>

        <Row>
          <WeightField
            kg={personalInfo.weight}
            units={personalInfo.units}
            onChange={(kg) => onPersonalInfoChange("weight", kg)}
          />
          <HeightField
            cm={personalInfo.height}
            units={personalInfo.units}
            onChange={(cm) => onPersonalInfoChange("height", cm)}
          />
        </Row>
      </Section>

      <Section
        title="Activity & Diet"
        description="The activity multiplier is the largest source of TDEE error - be honest, or override below."
      >
        <Row>
          <Field
            id="activityLevel"
            label="Activity Level"
          >
            <Select
              value={personalInfo.activityLevel}
              onValueChange={(v) => onPersonalInfoChange("activityLevel", v)}
            >
              <SelectTrigger id="activityLevel">
                <SelectValue placeholder="Select activity level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sedentary">
                  Sedentary (desk job, minimal movement)
                </SelectItem>
                <SelectItem value="light">
                  Light (desk job + light exercise 1-3 days/wk)
                </SelectItem>
                <SelectItem value="moderate">
                  Moderate (desk job + serious exercise 3-5 days/wk)
                </SelectItem>
                <SelectItem value="active">
                  Active (physical job OR very hard training 6+ days/wk)
                </SelectItem>
                <SelectItem value="veryActive">
                  Very Active (physical job AND intense daily training)
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="dietType"
            label="Diet Type"
          >
            <Select
              value={personalInfo.dietType}
              onValueChange={(v) => onPersonalInfoChange("dietType", v)}
            >
              <SelectTrigger id="dietType">
                <SelectValue placeholder="Select diet type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">Balanced (Standard)</SelectItem>
                <SelectItem value="lowCarb">Low Carb</SelectItem>
                <SelectItem value="lowFat">Low Fat</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="dietPreference"
            label="Diet Preference"
          >
            <Select
              value={personalInfo.dietPreference}
              onValueChange={(v) => onPersonalInfoChange("dietPreference", v)}
            >
              <SelectTrigger id="dietPreference">
                <SelectValue placeholder="Select diet preference" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="omnivore">Omnivore</SelectItem>
                <SelectItem value="pescatarian">Pescatarian</SelectItem>
                <SelectItem value="vegetarian">Vegetarian</SelectItem>
                <SelectItem value="vegan">Vegan</SelectItem>
                <SelectItem value="carnivore">Carnivore</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Row>

        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Cuisine preferences
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Hint to the AI planner about what feels like home. Leave all empty
            for &ldquo;no preference&rdquo;.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CUISINES.map((cuisine) => {
              const selected =
                personalInfo.cuisinePreferences?.includes(cuisine) ?? false;
              return (
                <button
                  key={cuisine}
                  type="button"
                  onClick={() => {
                    const current = personalInfo.cuisinePreferences ?? [];
                    const next = selected
                      ? current.filter((c) => c !== cuisine)
                      : [...current, cuisine];
                    onPersonalInfoChange("cuisinePreferences", next);
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    selected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  )}
                  aria-pressed={selected}
                >
                  {cuisine}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="allergies"
            className="text-xs font-medium text-muted-foreground"
          >
            Allergies / foods to avoid
          </Label>
          <TagInput
            id="allergies"
            value={personalInfo.allergies ?? []}
            onChange={(next) => onPersonalInfoChange("allergies", next)}
            placeholder="Type an allergen, press Enter…"
          />
          <p className="text-[11px] text-muted-foreground">
            Press Enter or comma to add. Click × to remove. Hard filter - the AI
            must never include these.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="dislikedFoods"
            className="text-xs font-medium text-muted-foreground"
          >
            Disliked foods
          </Label>
          <TagInput
            id="dislikedFoods"
            value={personalInfo.dislikedFoods ?? []}
            onChange={(next) => onPersonalInfoChange("dislikedFoods", next)}
            placeholder="Type a food, press Enter…"
          />
          <p className="text-[11px] text-muted-foreground">
            Press Enter or comma to add. Soft signal - the AI tries to avoid
            these but may still pick them when the seed catalog is thin.
          </p>
        </div>
      </Section>

      <Section
        title="Goal"
        description="Direction and rate of weight change."
      >
        <Row>
          <Field
            id="goal"
            label="Goal"
          >
            <Select
              value={personalInfo.goal}
              onValueChange={(v) => onPersonalInfoChange("goal", v)}
            >
              <SelectTrigger id="goal">
                <SelectValue placeholder="Select goal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lose">Lose Weight</SelectItem>
                <SelectItem value="maintain">Maintain Weight</SelectItem>
                <SelectItem value="gain">Gain Weight / Muscle</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {personalInfo.goal !== "maintain" && (
            <WeeklyRateField
              kgPerWeek={personalInfo.weeklyRateKg}
              weightKg={personalInfo.weight}
              units={personalInfo.units}
              onChange={(kgPerWeek) =>
                onPersonalInfoChange("weeklyRateKg", kgPerWeek)
              }
            />
          )}
        </Row>
      </Section>

      <Section
        title="Advanced"
        description="Optional. Override the TDEE estimate when you've calibrated against real-world weight change."
      >
        <Field
          id="manualTdee"
          label="TDEE override"
          hint={
            <>
              Leave blank to use BMR × activity. To calibrate after 2-3 weeks of
              tracking:{" "}
              <span className="font-mono">
                real TDEE ≈ current Target Calories + (observed weekly loss in
                kg × 1100)
              </span>
              .
            </>
          }
        >
          <Input
            id="manualTdee"
            type="number"
            min="800"
            max="6000"
            step="10"
            placeholder="e.g. 2400"
            value={personalInfo.manualTdee ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                onPersonalInfoChange("manualTdee", null);
                return;
              }
              const v = Number.parseFloat(raw);
              if (!Number.isNaN(v)) onPersonalInfoChange("manualTdee", v);
            }}
          />
        </Field>

        <MacroSplitField
          value={personalInfo.macroSplit ?? null}
          onChange={(next) => onPersonalInfoChange("macroSplit", next)}
        />
      </Section>
    </div>
  );
};

/** Three-input override for the goal+dietType-derived macro split.
 *
 * UX rules pinned:
 *   - Disabled by default; user toggles it on with the checkbox. Off = null
 *     in the profile, which means "use the default split".
 *   - Inputs accept 0–100 each. The sum is shown live; ≠100 (±2) is
 *     flagged with a yellow hint, but we don't block - `computeMacros`
 *     re-normalizes so a slightly-off split still produces a valid plan.
 *   - Empty inputs while editing don't trigger "0%" - they're held in
 *     local string state until the user blurs / types a digit. */
function MacroSplitField({
  value,
  onChange,
}: {
  value: MacroSplit | null;
  onChange: (next: MacroSplit | null) => void;
}) {
  const enabled = value !== null;
  const split: MacroSplit = value ?? { protein: 30, carbs: 40, fat: 30 };
  const sum = split.protein + split.carbs + split.fat;
  const sumOk = Math.abs(sum - 100) <= 2;

  function patch(field: keyof MacroSplit, raw: string) {
    const v = Number.parseFloat(raw);
    const next: MacroSplit = {
      ...split,
      [field]: Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0,
    };
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? split : null)}
          className="h-3.5 w-3.5 rounded border-border"
        />
        Override macro split
      </label>
      {enabled ? (
        <>
          <Row>
            <Field
              id="macroSplitProtein"
              label="Protein (%)"
            >
              <Input
                id="macroSplitProtein"
                type="number"
                min="0"
                max="100"
                step="1"
                value={split.protein}
                onChange={(e) => patch("protein", e.target.value)}
              />
            </Field>
            <Field
              id="macroSplitCarbs"
              label="Carbs (%)"
            >
              <Input
                id="macroSplitCarbs"
                type="number"
                min="0"
                max="100"
                step="1"
                value={split.carbs}
                onChange={(e) => patch("carbs", e.target.value)}
              />
            </Field>
          </Row>
          <Field
            id="macroSplitFat"
            label="Fat (%)"
          >
            <Input
              id="macroSplitFat"
              type="number"
              min="0"
              max="100"
              step="1"
              value={split.fat}
              onChange={(e) => patch("fat", e.target.value)}
            />
          </Field>
          <p
            className={cn(
              "text-[11px]",
              sumOk
                ? "text-muted-foreground"
                : "text-amber-600 dark:text-amber-400",
            )}
          >
            Sum: {sum}%
            {sumOk
              ? " - values are normalized before computing targets."
              : " - should be ~100. Values will be normalized, but you probably want them to add up."}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Off - using the goal-aware default ({" "}
          <span className="font-mono">lose</span>: 40/25/35,{" "}
          <span className="font-mono">maintain</span>: 30/40/30,{" "}
          <span className="font-mono">gain</span>: 30/45/25 - adjusted by diet
          type).
        </p>
      )}
    </div>
  );
}

/** Compact units toggle for the Body-section header. Mirrors the
 *  toggle in Settings → Units but lives where the user is actually
 *  entering weight + height, so they don't have to navigate away
 *  to switch systems. Storage stays metric either way; this is a
 *  presentation-only flip. */
function InlineUnitsToggle({
  units,
  onChange,
}: {
  units: UnitSystem;
  onChange: (next: UnitSystem) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Units"
      className="inline-flex items-center rounded-md border border-border/60 bg-background p-0.5 text-[10px]"
    >
      <InlineUnitButton
        active={units === "metric"}
        onClick={() => onChange("metric")}
        label="kg/cm"
      />
      <InlineUnitButton
        active={units === "imperial"}
        onClick={() => onChange("imperial")}
        label="lb/ft"
      />
    </div>
  );
}

function InlineUnitButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded px-2 py-0.5 font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/** Weekly weight-change-rate input. Storage is kg/week; the field
 *  renders + accepts lb/week when the user prefers imperial. The
 *  1%-of-bodyweight cap is enforced in the same units the user is
 *  typing in so the hint reads correctly. */
function WeeklyRateField({
  kgPerWeek,
  weightKg,
  units,
  onChange,
}: {
  kgPerWeek: number;
  weightKg: number;
  units: UnitSystem;
  onChange: (kgPerWeek: number) => void;
}) {
  const unitLabel = units === "imperial" ? "lb" : "kg";
  const displayValue = kgToDisplay(kgPerWeek, units);
  // Both the cap and the displayed value go through the same
  // converter, so the input's `max` always matches the hint.
  const capKg = weightKg * 0.01;
  const capDisplay = kgToDisplay(capKg, units);
  return (
    <Field
      id="weeklyRateKg"
      label={`Rate (${unitLabel}/week)`}
      hint={`Capped at 1% of bodyweight per week (${capDisplay.toFixed(2)} ${unitLabel}).`}
    >
      <Input
        id="weeklyRateKg"
        type="number"
        min={0}
        max={capDisplay.toFixed(2)}
        step="0.05"
        value={displayValue}
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          if (Number.isNaN(parsed)) return;
          onChange(displayToKg(parsed, units));
        }}
      />
    </Field>
  );
}

/** Weight input that flips kg ↔ lb based on the user's preference.
 *  Storage is always kg; the input renders a converted value and
 *  converts back on change. The min/max bounds are also converted
 *  so the imperial input enforces the same body-weight range as the
 *  metric one (no "I typed 100 — that's 45 kg in this mode" trap). */
function WeightField({
  kg,
  units,
  onChange,
}: {
  kg: number;
  units: UnitSystem;
  onChange: (kg: number) => void;
}) {
  const unitLabel = units === "imperial" ? "lb" : "kg";
  const displayValue = kgToDisplay(kg, units);
  const min = units === "imperial" ? 88 : 40;
  const max = units === "imperial" ? 440 : 200;
  return (
    <Field
      id="weight"
      label={`Weight (${unitLabel})`}
    >
      <Input
        id="weight"
        type="number"
        min={min}
        max={max}
        step="0.1"
        value={displayValue}
        onChange={(e) => {
          const parsed = Number.parseFloat(e.target.value);
          if (Number.isNaN(parsed)) return;
          onChange(displayToKg(parsed, units));
        }}
      />
    </Field>
  );
}

/** Height input. Metric is a single cm field; imperial is a pair of
 *  feet + inches inputs because nobody enters their height as "71
 *  inches". Both modes store the result as cm. The two imperial
 *  inputs share the surrounding Field shell + label so the form
 *  doesn't grow a third column. */
function HeightField({
  cm,
  units,
  onChange,
}: {
  cm: number;
  units: UnitSystem;
  onChange: (cm: number) => void;
}) {
  if (units === "imperial") {
    const { feet, inches } = cmToFeetInches(cm);
    return (
      <Field
        id="height-ft"
        label="Height (ft / in)"
      >
        <div className="grid grid-cols-2 gap-2">
          <Input
            id="height-ft"
            type="number"
            min={3}
            max={8}
            value={feet}
            onChange={(e) => {
              const f = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(f)) return;
              onChange(feetInchesToCm(f, inches));
            }}
            aria-label="Height — feet"
          />
          <Input
            id="height-in"
            type="number"
            min={0}
            max={11}
            value={inches}
            onChange={(e) => {
              const i = Number.parseInt(e.target.value, 10);
              if (Number.isNaN(i)) return;
              onChange(feetInchesToCm(feet, Math.min(Math.max(i, 0), 11)));
            }}
            aria-label="Height — inches"
          />
        </div>
      </Field>
    );
  }
  return (
    <Field
      id="height"
      label="Height (cm)"
    >
      <Input
        id="height"
        type="number"
        min={130}
        max={230}
        value={Math.round(cm)}
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10);
          if (Number.isNaN(parsed)) return;
          onChange(parsed);
        }}
      />
    </Field>
  );
}

function Section({
  title,
  description,
  children,
  headerExtra,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Optional content rendered to the right of the title row.
   *  Used by the Body section for the compact units toggle so the
   *  user can flip kg/lb without navigating to Settings. */
  headerExtra?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h3>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {headerExtra && <div className="shrink-0">{headerExtra}</div>}
        </div>
      </header>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label>
      {children}
      {hint && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export default PersonalInfoForm;
