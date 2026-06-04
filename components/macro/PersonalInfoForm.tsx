"use client";

import React from "react";
import {
  CUISINES,
  type MacroSplit,
  PersonalInfo,
} from "../../components/macro/types";
import { displayToKg, kgToDisplay, type UnitSystem } from "../../lib/units";
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
import { Field, Row, Section } from "./FormFields";
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
  return (
    <div className="space-y-6">
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
    </div>
  );
};

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

export default PersonalInfoForm;
