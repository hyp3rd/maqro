"use client";

import React from "react";
import {
  cmToFeetInches,
  displayToKg,
  feetInchesToCm,
  kgToDisplay,
  type UnitSystem,
} from "../../lib/units";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** Shared form primitives for the body/profile/calculator forms.
 *
 *  Extracted from `PersonalInfoForm` when the Body card moved to its own
 *  `ProfileView`: the layout shells (`Section`/`Row`/`Field`), the inline
 *  units toggle, and the unit-aware `WeightField`/`HeightField` are now used
 *  by both forms, so they live here instead of being duplicated. Goal-only
 *  inputs (the weekly-rate field, the macro-split override) stay local to
 *  `PersonalInfoForm` — they have a single caller. */

export function Section({
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

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
  );
}

export function Field({
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

/** Compact units toggle for the Body-section header. Mirrors the
 *  toggle in Settings → Units but lives where the user is actually
 *  entering weight + height, so they don't have to navigate away
 *  to switch systems. Storage stays metric either way; this is a
 *  presentation-only flip. */
export function InlineUnitsToggle({
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

/** Weight input that flips kg ↔ lb based on the user's preference.
 *  Storage is always kg; the input renders a converted value and
 *  converts back on change. The min/max bounds are also converted
 *  so the imperial input enforces the same body-weight range as the
 *  metric one (no "I typed 100 — that's 45 kg in this mode" trap). */
export function WeightField({
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
export function HeightField({
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
