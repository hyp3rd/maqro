"use client";

import React from "react";
import type { PersonalInfo } from "../../components/macro/types";
import { ageFromBirthDate } from "../../lib/age";
import type { ViewKey } from "../shell/Sidebar";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { BloodPressureSection } from "./BloodPressureSection";
import { BodyMeasurementHistory } from "./BodyMeasurementHistory";
import {
  Field,
  HeightField,
  InlineUnitsToggle,
  Row,
  Section,
  WeightField,
} from "./FormFields";

interface ProfileViewProps {
  personalInfo: PersonalInfo;
  onPersonalInfoChange: (name: string, value: string | number | null) => void;
  /** Local `YYYY-MM-DD` (from `useToday`). Used to derive the age shown under
   *  the birthdate and to cap the picker at today. Empty during SSR / first
   *  paint; the client fills it in immediately after hydrate. */
  today: string;
  /** Switch the main app view — used by the measurement archive's shortcut to
   *  the Progress view, where measurements are actually logged. */
  onSelectView?: (key: ViewKey) => void;
}

/** Profile page — the home for the user's body data (gender, birthdate-derived
 *  age, weight, height, units, display name). Extracted from the Calculator's
 *  Body card so the Calculator can focus on goal/diet inputs, and so this page
 *  can grow into the home for blood-pressure readings + a body-measurement
 *  history archive (the placeholder section below; wired up in a follow-up).
 *
 *  Age is derived from `birthDate` so it stays current on its own and the
 *  calorie target shifts silently on a birthday — see [lib/age.ts](../../lib/age.ts). */
export function ProfileView({
  personalInfo,
  onPersonalInfoChange,
  today,
  onSelectView,
}: ProfileViewProps) {
  // Derive the displayed age from `birthDate` against *today* (passed in, so
  // the render stays pure — no clock read here). `today` is a local
  // YYYY-MM-DD; reading it at local midnight is all `ageFromBirthDate` needs.
  const nowMs = today ? new Date(`${today}T00:00:00`).getTime() : null;
  const derivedAge =
    nowMs !== null ? ageFromBirthDate(personalInfo.birthDate, nowMs) : null;
  const hasBirthDate = Boolean(personalInfo.birthDate);

  return (
    <div className="space-y-6">
      <Section
        title="Body"
        description="Used to estimate your BMR and TDEE — the basis for every calorie target."
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
            id="birthDate"
            label="Birthdate"
            hint={
              hasBirthDate
                ? derivedAge !== null
                  ? `${derivedAge} years old — your age (and targets) keep themselves current.`
                  : undefined
                : "Set your birthdate and your age stays current automatically — no yearly edit."
            }
          >
            <Input
              id="birthDate"
              type="date"
              value={personalInfo.birthDate ?? ""}
              min="1900-01-01"
              max={today || undefined}
              onChange={(e) =>
                onPersonalInfoChange("birthDate", e.target.value || null)
              }
            />
          </Field>
        </Row>

        {/* Legacy fallback: profiles created before birthdate existed keep an
            editable age until the user sets a birthdate. Once a birthdate is
            present it's the single source of truth and this drops away. */}
        {!hasBirthDate && (
          <Row>
            <Field
              id="age"
              label="Age (years)"
              hint="Used until you add a birthdate above."
            >
              <Input
                id="age"
                type="number"
                min={18}
                max={100}
                value={personalInfo.age}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) onPersonalInfoChange("age", v);
                }}
              />
            </Field>
          </Row>
        )}

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

      <BloodPressureSection />

      <BodyMeasurementHistory
        gender={personalInfo.gender}
        heightCm={personalInfo.height}
        units={personalInfo.units}
        onGoToProgress={
          onSelectView ? () => onSelectView("progress") : undefined
        }
      />
    </div>
  );
}

export default ProfileView;
