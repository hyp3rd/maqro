"use client";

import { useUser } from "@/hooks/use-user";
import React, { useState } from "react";
import { ArrowLeft, CreditCard, FolderOpen, HeartPulse } from "lucide-react";
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
import { BillingSection } from "./BillingSection";
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
import { SavedReportsList } from "./SavedReportsList";

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

type Sub = "home" | "measurements" | "docs" | "billing";

/** Profile page — the home for the user's body data (gender, birthdate-derived
 *  age, weight, height, units, display name), plus three tiles that open
 *  sub-sections: **My measurements** (blood pressure + body-measurement
 *  history), **My docs** (report PDFs archived to encrypted cloud storage), and
 *  **Billing & subscription** (plan, renewal, the Stripe portal — moved here out
 *  of Settings).
 *
 *  Age is derived from `birthDate` so it stays current on its own and the
 *  calorie target shifts silently on a birthday — see [lib/age.ts](../../lib/age.ts). */
export function ProfileView({
  personalInfo,
  onPersonalInfoChange,
  today,
  onSelectView,
}: ProfileViewProps) {
  const [sub, setSub] = useState<Sub>("home");
  const { user } = useUser();

  if (sub === "measurements") {
    return (
      <div className="space-y-6">
        <SubHeader
          title="My measurements"
          onBack={() => setSub("home")}
        />
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

  if (sub === "docs") {
    return (
      <div className="space-y-6">
        <SubHeader
          title="My documents"
          onBack={() => setSub("home")}
        />
        {user ? (
          <SavedReportsList />
        ) : (
          <p className="rounded-lg border border-border/60 bg-card px-5 py-4 text-sm text-muted-foreground">
            Sign in to save and access your documents — encrypted report PDFs —
            in the cloud.
          </p>
        )}
      </div>
    );
  }

  if (sub === "billing") {
    return (
      <div className="space-y-6">
        <SubHeader
          title="Billing & subscription"
          onBack={() => setSub("home")}
        />
        {user ? (
          <BillingSection />
        ) : (
          <p className="rounded-lg border border-border/60 bg-card px-5 py-4 text-sm text-muted-foreground">
            Sign in to view your plan, manage your subscription, and see your
            billing history.
          </p>
        )}
      </div>
    );
  }

  return (
    <ProfileHome
      personalInfo={personalInfo}
      onPersonalInfoChange={onPersonalInfoChange}
      today={today}
      onOpen={setSub}
    />
  );
}

function ProfileHome({
  personalInfo,
  onPersonalInfoChange,
  today,
  onOpen,
}: {
  personalInfo: PersonalInfo;
  onPersonalInfoChange: (name: string, value: string | number | null) => void;
  today: string;
  onOpen: (sub: Exclude<Sub, "home">) => void;
}) {
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <ProfileTile
          icon={HeartPulse}
          title="My measurements"
          hint="Blood pressure & body measurements"
          onClick={() => onOpen("measurements")}
        />
        <ProfileTile
          icon={FolderOpen}
          title="My docs"
          hint="Reports saved to your cloud"
          onClick={() => onOpen("docs")}
        />
        <ProfileTile
          icon={CreditCard}
          title="Billing & subscription"
          hint="Plan, renewal & payment"
          onClick={() => onOpen("billing")}
        />
      </div>
    </div>
  );
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Profile
      </button>
      <span
        aria-hidden
        className="text-muted-foreground/40"
      >
        /
      </span>
      <span className="text-sm font-medium text-foreground">{title}</span>
    </div>
  );
}

function ProfileTile({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex aspect-square flex-col items-start justify-between rounded-xl border border-border/60 bg-card p-5 text-left transition-colors hover:border-brand/40 hover:bg-accent/40"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  );
}

export default ProfileView;
