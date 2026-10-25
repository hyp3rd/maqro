"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/i18n/number";
import {
  TRAINING_INTENSITY_LABEL,
  TRAINING_TYPE_LABEL,
} from "@/lib/training-labels";
import { cn } from "@/lib/utils";
import { useId } from "react";
import { useLocale } from "next-intl";
import { TRAINING_INTENSITIES, TRAINING_TYPES } from "@maqro/core/training";
import type {
  TrainingDay,
  TrainingIntensity,
  TrainingType,
} from "@maqro/core/types";

/** Longest session the engine accepts (`parseTrainingDay`). */
const MAX_DURATION_MIN = 24 * 60;

/** A session being edited: every field as its control holds it. */
export type SessionDraft = {
  type: TrainingType;
  /** `null` while unset: the engine classes a session without an
   *  intensity on its own terms (`classifyTrainingDay`), so a stored day
   *  without one keeps none until the user picks one. */
  intensity: TrainingIntensity | null;
  time: string;
  /** The input's text, so a half-typed value doesn't jump around. */
  duration: string;
  /** Trains without eating first: no pre-workout meal that day. */
  fasted: boolean;
};

export function toSessionDraft(day: TrainingDay): SessionDraft {
  return {
    type: day.type,
    intensity: day.intensity ?? null,
    time: day.time ?? "",
    duration: day.durationMin !== undefined ? String(day.durationMin) : "",
    fasted: day.fasted === true,
  };
}

/** The draft's duration: `null` when blank (it is optional), the minutes
 *  when whole and in 1–1440, else `"invalid"`: shown, never dropped. */
function draftDuration(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  const minutes = Number(text);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_DURATION_MIN
    ? minutes
    : "invalid";
}

/** The draft holds a duration the engine would not accept: the fields show
 *  why, and the caller holds its save until it is fixed or cleared. */
export function sessionDraftInvalid(draft: SessionDraft): boolean {
  return draft.type !== "rest" && draftDuration(draft.duration) === "invalid";
}

/** The session the draft describes: a rest day carries nothing else; an
 *  unset intensity, an empty time, a blank duration and a session that isn't
 *  fasted are left out (the caller holds its save while the duration is
 *  invalid). */
export function draftToSession(draft: SessionDraft): TrainingDay {
  if (draft.type === "rest") return { type: "rest" };
  const day: TrainingDay = { type: draft.type };
  if (draft.intensity !== null) day.intensity = draft.intensity;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) day.time = draft.time;
  const minutes = draftDuration(draft.duration);
  if (typeof minutes === "number") day.durationMin = minutes;
  if (draft.fasted) day.fasted = true;
  return day;
}

/** The session controls shared by the template's day dialog and the
 *  per-date day-type sheet: type, then intensity, start time, duration and
 *  "I train fasted" (kept in place but disabled on a rest day, in both
 *  sheets). */
export function TrainingSessionFields({
  draft,
  onChange,
}: {
  draft: SessionDraft;
  onChange: (patch: Partial<SessionDraft>) => void;
}) {
  const locale = useLocale();
  const id = useId();
  const durationInvalid = sessionDraftInvalid(draft);
  const rest = draft.type === "rest";
  return (
    <>
      <div className="space-y-2">
        <p
          id={`${id}-type`}
          className="text-label font-medium text-foreground"
        >
          Session
        </p>
        <SegmentedControl
          aria-labelledby={`${id}-type`}
          value={draft.type}
          onValueChange={(type) => onChange({ type })}
          options={TRAINING_TYPES.map((t) => ({
            value: t,
            label: TRAINING_TYPE_LABEL[t],
          }))}
          className="grid-flow-row grid-cols-3 sm:grid-cols-4"
        />
      </div>

      {/* Kept on a rest day, disabled, so the sheet never jumps in height
          as the type changes; the draft keeps what was entered for when a
          session is picked again. */}
      <fieldset
        disabled={rest}
        className="group m-0 grid min-w-0 gap-5 border-0 p-0"
      >
        <div className="space-y-2">
          <p
            id={`${id}-intensity`}
            className="text-label font-medium text-foreground group-disabled:text-muted-foreground"
          >
            Intensity
          </p>
          <SegmentedControl
            aria-labelledby={`${id}-intensity`}
            value={draft.intensity}
            onValueChange={(intensity) => onChange({ intensity })}
            options={TRAINING_INTENSITIES.map((i) => ({
              value: i,
              label: TRAINING_INTENSITY_LABEL[i],
            }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label
              htmlFor={`${id}-time`}
              className="text-label group-disabled:text-muted-foreground"
            >
              Start time
            </Label>
            <Input
              id={`${id}-time`}
              type="time"
              value={draft.time}
              onChange={(e) => onChange({ time: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor={`${id}-duration`}
              className="text-label group-disabled:text-muted-foreground"
            >
              Duration (min)
            </Label>
            <Input
              id={`${id}-duration`}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DURATION_MIN}
              step={5}
              value={draft.duration}
              onChange={(e) => onChange({ duration: e.target.value })}
              placeholder="60"
              aria-invalid={durationInvalid}
              aria-describedby={`${id}-duration-hint`}
              className={cn(durationInvalid && "border-warning")}
            />
          </div>
        </div>
        {/* Two text-label lines on a phone, where the longest hint wraps, so
            the shorter rest-day hint doesn't move the actions below. */}
        <p
          id={`${id}-duration-hint`}
          className={cn(
            "min-h-[2.25rem] text-label sm:min-h-0",
            durationInvalid ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {rest
            ? "A rest day has no session details."
            : durationInvalid
              ? `Enter whole minutes from 1 to ${formatNumber(MAX_DURATION_MIN, locale)}, or leave it blank.`
              : "Both optional. A long endurance session counts as a bigger day."}
        </p>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label
              htmlFor={`${id}-fasted`}
              className="text-label group-disabled:text-muted-foreground"
            >
              I train fasted
            </Label>
            <p
              id={`${id}-fasted-hint`}
              className="mt-0.5 text-label text-muted-foreground"
            >
              No pre-workout meal; at least 25 g of protein soon after. Fasted
              training burns no more fat over the day.
            </p>
          </div>
          <Switch
            id={`${id}-fasted`}
            aria-describedby={`${id}-fasted-hint`}
            checked={!rest && draft.fasted}
            onCheckedChange={(fasted) => onChange({ fasted })}
          />
        </div>
      </fieldset>
    </>
  );
}
