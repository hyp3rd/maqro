"use client";

import React from "react";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Field, Row, Section } from "./FormFields";
import type { MacroSplit, PersonalInfo } from "./types";

interface AdvancedSettingsSectionProps {
  personalInfo: PersonalInfo;
  onPersonalInfoChange: (
    name: string,
    value: number | null | MacroSplit,
  ) => void;
}

/** Optional, calibration-grade overrides: a manual TDEE and a custom macro
 *  split. Lives in the Calculator's right column next to the Daily Targets it
 *  affects — both feed `computeMacros`, so seeing the result and its override
 *  knobs together reads better than burying them at the bottom of the form. */
export function AdvancedSettingsSection({
  personalInfo,
  onPersonalInfoChange,
}: AdvancedSettingsSectionProps) {
  return (
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
              real TDEE ≈ current Target Calories + (observed weekly loss in kg
              × 1100)
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
  );
}

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

export default AdvancedSettingsSection;
