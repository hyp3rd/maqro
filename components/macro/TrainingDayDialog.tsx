"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatNumber } from "@/lib/i18n/number";
import { cn } from "@/lib/utils";
import { useId, useState } from "react";
import { useLocale } from "next-intl";
import {
  TRAINING_INTENSITIES,
  TRAINING_TYPES,
  classifyTrainingDay,
} from "@maqro/core/training";
import type {
  TrainingDay,
  TrainingIntensity,
  TrainingType,
} from "@maqro/core/types";
import {
  DAY_CLASS_LABEL,
  TRAINING_INTENSITY_LABEL,
  TRAINING_TYPE_LABEL,
  WEEKDAY_NAME,
} from "./training-labels";

/** Longest session the engine accepts (`normalizeTrainingDay`). */
const MAX_DURATION_MIN = 24 * 60;

type Draft = {
  type: TrainingType;
  /** `null` while unset: the engine classes a session without an
   *  intensity on its own terms (`classifyTrainingDay`), so a stored day
   *  without one keeps none until the user picks one. */
  intensity: TrainingIntensity | null;
  time: string;
  /** The input's text, so a half-typed value doesn't jump around. */
  duration: string;
};

function toDraft(day: TrainingDay): Draft {
  return {
    type: day.type,
    intensity: day.intensity ?? null,
    time: day.time ?? "",
    duration: day.durationMin !== undefined ? String(day.durationMin) : "",
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

/** The session the draft describes: a rest day carries nothing else; an
 *  unset intensity, an empty time and a blank duration are left out (Save
 *  is held while the duration is invalid). */
function draftToDay(draft: Draft): TrainingDay {
  if (draft.type === "rest") return { type: "rest" };
  const day: TrainingDay = { type: draft.type };
  if (draft.intensity !== null) day.intensity = draft.intensity;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) day.time = draft.time;
  const minutes = draftDuration(draft.duration);
  if (typeof minutes === "number") day.durationMin = minutes;
  return day;
}

type Props = {
  /** `getDay()` of the day being edited (0 = Sunday). */
  weekday: number;
  day: TrainingDay;
  /** Planned kcal for this day if `day` were saved — the live preview. */
  plannedKcal: (day: TrainingDay) => number | null;
  onSave: (day: TrainingDay) => void;
  onOpenChange: (open: boolean) => void;
};

/** Edit one weekday's session: type, intensity, start time and duration,
 *  with the day's planned calories updating as you choose. A bottom sheet
 *  on phones and a dialog on wider screens (`DialogContent`); Radix traps
 *  focus inside and returns it to the row that opened it. Mount it with a
 *  `key` per weekday so each open starts from the stored session. */
export function TrainingDayDialog({
  weekday,
  day,
  plannedKcal,
  onSave,
  onOpenChange,
}: Props) {
  const locale = useLocale();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(day));
  const next = draftToDay(draft);
  const durationInvalid =
    draft.type !== "rest" && draftDuration(draft.duration) === "invalid";
  const kcal = plannedKcal(next);
  const name = WEEKDAY_NAME[weekday] ?? "";
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
    >
      <DialogContent className="gap-5">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription aria-live="polite">
            {DAY_CLASS_LABEL[classifyTrainingDay(next)]}
            {kcal !== null && (
              <>
                {" · "}
                <span className="font-mono tabular-nums text-foreground">
                  {formatNumber(kcal, locale)}
                </span>{" "}
                kcal planned
              </>
            )}
          </DialogDescription>
        </DialogHeader>

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
            onValueChange={(type) => set({ type })}
            options={TRAINING_TYPES.map((t) => ({
              value: t,
              label: TRAINING_TYPE_LABEL[t],
            }))}
            className="grid-flow-row grid-cols-3 sm:grid-cols-4"
          />
        </div>

        {draft.type !== "rest" && (
          <>
            <div className="space-y-2">
              <p
                id={`${id}-intensity`}
                className="text-label font-medium text-foreground"
              >
                Intensity
              </p>
              <SegmentedControl
                aria-labelledby={`${id}-intensity`}
                value={draft.intensity}
                onValueChange={(intensity) => set({ intensity })}
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
                  className="text-label"
                >
                  Start time
                </Label>
                <Input
                  id={`${id}-time`}
                  type="time"
                  value={draft.time}
                  onChange={(e) => set({ time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor={`${id}-duration`}
                  className="text-label"
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
                  onChange={(e) => set({ duration: e.target.value })}
                  placeholder="60"
                  aria-invalid={durationInvalid}
                  aria-describedby={`${id}-duration-hint`}
                  className={cn(durationInvalid && "border-warning")}
                />
              </div>
            </div>
            <p
              id={`${id}-duration-hint`}
              className={cn(
                "text-label",
                durationInvalid ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {durationInvalid
                ? `Enter whole minutes from 1 to ${formatNumber(MAX_DURATION_MIN, locale)}, or leave it blank.`
                : "Both optional. A long endurance session counts as a bigger day."}
            </p>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={durationInvalid}
            onClick={() => onSave(next)}
          >
            Save {name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
