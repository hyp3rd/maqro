"use client";

import React from "react";
import { ArrowRight, UserCircle } from "lucide-react";
import type { PersonalInfo } from "../../components/macro/types";
import { effectiveAge } from "../../lib/age";
import { formatHeight, formatWeight } from "../../lib/units";

const GENDER_LABELS: Record<PersonalInfo["gender"], string> = {
  male: "Male",
  female: "Female",
  nonbinary: "Non-binary",
  preferNotToSay: "Unspecified",
};

/** Compact, read-only recap of the body inputs that drive the calorie target.
 *  Those inputs now live on the Profile page, so the Calculator shows this
 *  strip (gender · age · weight · height) to keep the numbers its targets
 *  depend on visible — tapping it jumps to Profile to edit them.
 *
 *  Age is birthdate-derived against `today` (passed in to keep the render
 *  pure), so it reflects the same value the targets are computed from. */
export function BodySummaryStrip({
  personalInfo,
  today,
  onEdit,
}: {
  personalInfo: PersonalInfo;
  /** Local `YYYY-MM-DD` (from `useToday`); drives the birthdate-derived age.
   *  Empty during SSR / first paint — we fall back to the stored age. */
  today: string;
  onEdit: () => void;
}) {
  const age = today
    ? effectiveAge(personalInfo, new Date(`${today}T00:00:00`).getTime())
    : personalInfo.age;

  const stats = [
    GENDER_LABELS[personalInfo.gender],
    `${age} yrs`,
    formatWeight(personalInfo.weight, personalInfo.units),
    formatHeight(personalInfo.height, personalInfo.units),
  ];

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-4 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-accent/40"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <UserCircle className="h-4 w-4 shrink-0 text-brand" />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          {stats.map((stat, i) => (
            <React.Fragment key={stat}>
              {i > 0 && (
                <span
                  aria-hidden
                  className="text-muted-foreground/40"
                >
                  ·
                </span>
              )}
              <span
                className={
                  i === 0
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }
              >
                {stat}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
        <span className="hidden sm:inline">Edit on Profile</span>
        <span className="sm:hidden">Edit</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

export default BodySummaryStrip;
