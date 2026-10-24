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
import { formatNumber } from "@/lib/i18n/number";
import { WEEKDAY_NAME, dayTypeLabel } from "@/lib/training-labels";
import { useState } from "react";
import { useLocale } from "next-intl";
import { classifyTrainingDay } from "@maqro/core/training";
import type { TrainingDay } from "@maqro/core/types";
import {
  type SessionDraft,
  TrainingSessionFields,
  draftToSession,
  sessionDraftInvalid,
  toSessionDraft,
} from "./TrainingSessionFields";

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
  const [draft, setDraft] = useState<SessionDraft>(() => toSessionDraft(day));
  const next = draftToSession(draft);
  const durationInvalid = sessionDraftInvalid(draft);
  const kcal = plannedKcal(next);
  const name = WEEKDAY_NAME[weekday] ?? "";

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
    >
      <DialogContent className="gap-5">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription aria-live="polite">
            {dayTypeLabel({ day: next, dayClass: classifyTrainingDay(next) })}
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

        <TrainingSessionFields
          draft={draft}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />

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
