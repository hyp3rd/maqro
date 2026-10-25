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
import { useDayOverrides } from "@/hooks/use-day-overrides";
import { haptic } from "@/lib/haptics";
import { formatNumber } from "@/lib/i18n/number";
import {
  WEEKDAY_NAME,
  dayTypeLabel,
  sessionLabel,
} from "@/lib/training-labels";
import { type RefObject, useId, useState } from "react";
import { useLocale } from "next-intl";
import type { DateTargets } from "@maqro/core/targets";
import type { TrainingDay } from "@maqro/core/types";
import {
  type SessionDraft,
  TrainingSessionFields,
  draftToSession,
  sessionDraftInvalid,
  toSessionDraft,
} from "./TrainingSessionFields";

/** What the sheet needs from the app's targets (`useTargets`). */
type DaySessionProps = {
  /** The shown day's targets (`dayTargets`). Without an enabled training
   *  schedule there is no `training`, and nothing renders. */
  targets: DateTargets;
  /** Local `YYYY-MM-DD` — words the shown day as "today". */
  today: string;
  /** The shown day's targets for a candidate session (`null` = the plan),
   *  through the same resolver and context (`previewDayTargets`). */
  previewDayTargets: (date: string, day: TrainingDay | null) => DateTargets;
};

/** Sessions are equal when every field is (a rest day carries no other). */
function sameSession(a: TrainingDay, b: TrainingDay): boolean {
  return (
    a.type === b.type &&
    (a.type === "rest" ||
      (a.intensity === b.intensity &&
        a.time === b.time &&
        a.durationMin === b.durationMin &&
        (a.fasted === true) === (b.fasted === true)))
  );
}

/** `Today’s` / `Thursday’s` for the shown day. */
function dayPossessive(date: string, today: string): string {
  if (date === today) return "Today’s";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return `${WEEKDAY_NAME[weekday] ?? "This day"}’s`;
}

/** Change ONE day's session without touching the weekly template: shows
 *  the template's plan for the date, lets the user pick another session or
 *  rest, previews the day's new target through the same resolver ("2,500 →
 *  1,950 kcal"), and saves it as a per-date override. "Back to plan"
 *  removes the override. Only that day changes — the rest of the week is
 *  never rebalanced.
 *
 *  A bottom sheet on phones and a dialog on wider screens (`DialogContent`);
 *  Radix traps focus inside, and on close focus returns to `returnFocusTo`
 *  (the control that opened it: Today's session chip, `DayTypeChip`; the
 *  sheet has no Radix trigger, so without it focus falls to <body>). Mount
 *  it per open so each one starts from the day's current session, and
 *  unmount it if `targets` would move to another date: the draft belongs
 *  to the day it was opened for. */
export function DayTypeSheet({
  targets,
  today,
  previewDayTargets,
  onOpenChange,
  returnFocusTo,
}: DaySessionProps & {
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const locale = useLocale();
  const id = useId();
  const { setOverride, clearOverride } = useDayOverrides();
  const training = targets.training;
  const [draft, setDraft] = useState<SessionDraft>(() =>
    toSessionDraft(training?.day ?? { type: "rest" }),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!training) return null;

  const date = targets.date;
  const next = draftToSession(draft);
  // A typed duration the engine won't take is shown, never dropped: Save
  // waits until it is fixed or cleared.
  const durationInvalid = sessionDraftInvalid(draft);
  const backToPlan = sameSession(next, training.plannedDay);
  const preview = previewDayTargets(date, backToPlan ? null : next);
  const from = targets.targetCalories;
  const to = preview.targetCalories;
  const kcal = (n: number) => formatNumber(n, locale);
  const whose = dayPossessive(date, today);

  const close = () => onOpenChange(false);
  const commit = async (write: () => Promise<boolean>) => {
    setBusy(true);
    setFailed(false);
    const ok = await write();
    setBusy(false);
    if (!ok) {
      setFailed(true);
      return;
    }
    haptic("success");
    close();
  };
  const save = () => {
    // Choosing the planned session IS going back to the plan: no override
    // row that merely repeats the template.
    if (backToPlan) {
      if (training.overridden) void commit(() => clearOverride(date));
      else close();
      return;
    }
    // Re-saving the stored override changes nothing, but the write would
    // still count as a pending change until the next sync.
    if (training.overridden && sameSession(next, training.day)) {
      close();
      return;
    }
    void commit(() => setOverride(date, next));
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
    >
      <DialogContent
        className="gap-5"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle>{whose} session</DialogTitle>
          <DialogDescription>
            Planned: {sessionLabel(training.plannedDay)}
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3"
          aria-labelledby={`${id}-target`}
          role="group"
        >
          <p
            id={`${id}-target`}
            className="text-label text-muted-foreground"
          >
            Calorie target
          </p>
          <p
            aria-live="polite"
            className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-xl font-medium tabular-nums text-foreground"
          >
            {to === from ? (
              <span>{kcal(to)} kcal</span>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {kcal(from)}
                  <span className="sr-only"> kcal now, </span>
                </span>
                <span
                  aria-hidden
                  className="text-muted-foreground"
                >
                  →
                </span>
                <span>
                  {kcal(to)} kcal
                  <span className="sr-only"> with this session</span>
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-label text-muted-foreground">
            {preview.training ? dayTypeLabel(preview.training) : ""}
            {" · "}
            {kcal(preview.protein)} g protein · {kcal(preview.carbs)} g carbs ·{" "}
            {kcal(preview.fat)} g fat
          </p>
        </div>

        <TrainingSessionFields
          draft={draft}
          onChange={(patch) => {
            if (patch.type !== undefined) haptic("select");
            setDraft((d) => ({ ...d, ...patch }));
          }}
        />

        <p className="text-label text-muted-foreground">
          Changes this day only. The rest of your week stays as planned.
        </p>

        {failed && (
          <p
            role="alert"
            className="text-label text-foreground"
          >
            This change couldn’t be saved on this device. Try again.
          </p>
        )}

        {/* On a phone the actions stay in reach while the sheet scrolls:
            stuck to the bottom of the sheet, over its safe-area padding. */}
        <DialogFooter className="sticky bottom-0 -mx-5 gap-2 border-t border-border/60 bg-background px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 sm:static sm:mx-0 sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0">
          {training.overridden ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void commit(() => clearOverride(date))}
            >
              Back to plan
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="brand"
            disabled={busy || durationInvalid}
            onClick={save}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
