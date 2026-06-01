"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";

/** localStorage key recording the user's "don't show this again"
 *  choice for the pre-diabetic disclaimer. Set to "1" once dismissed
 *  with the checkbox ticked; unset / any other value re-shows the
 *  dialog on each pill click. Kept namespaced so wiping site data is
 *  the obvious reset path. */
const DISMISSED_KEY = "maqro:disclaimer:pre-diabetic-dismissed";

/** Returns true when the user previously asked not to see this
 *  disclaimer again. Tolerant of SSR (no window) and a quota-exceeded
 *  / disabled-storage browser — both treat the result as "not
 *  dismissed", which fails safe by re-showing the warning. */
export function hasDismissedPreDiabeticDisclaimer(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Disclaimer gate shown before the "Adapt for pre-diabetics" refiner
 *  fires. The pill describes a clinically-adjacent intent (blood-
 *  glucose management) and the AI's suggestions can collide with
 *  medications and individual treatment plans in ways the model
 *  doesn't know about — so the user has to acknowledge the limits
 *  before we send the prompt. Same neutral-but-direct tone as the
 *  /terms page.
 *
 *  Dismissal is sticky: ticking "Don't show this again" persists the
 *  acknowledgement in `localStorage` so power users aren't punished
 *  for repeated use. Unticked → the warning shows next time. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires when the user clicks "I understand — continue". The
   *  caller dispatches the actual refiner request. */
  onAccept: () => void;
};

export function PreDiabeticDisclaimerDialog({
  open,
  onOpenChange,
  onAccept,
}: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  function handleAccept() {
    if (dontShowAgain && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(DISMISSED_KEY, "1");
      } catch {
        // localStorage unavailable (private mode quota, disabled
        // storage). Silently ignore — the dialog will just re-show
        // next time, which is the safer fallback.
      }
    }
    onOpenChange(false);
    onAccept();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Before applying this adjustment</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-left">
            <span className="block">
              This adjustment is <strong>not medical advice</strong> and not a
              substitute for guidance from a doctor, registered dietitian, or
              certified diabetes educator.
            </span>
            <span className="block">
              The AI doesn&apos;t know your medications (metformin,
              sulfonylureas, insulin, etc.), other conditions, lab values, or
              treatment plan. Suggestions that are sensible for one person with
              pre-diabetes can be wrong — sometimes dangerous — for another. If
              you&apos;ve been diagnosed with pre-diabetes or diabetes, please
              work with a qualified professional before acting on AI-generated
              meal plans.
            </span>
            <span className="block">
              The plan that comes back will skew toward lower-GI carbs, higher
              fiber and protein, even carb distribution, and minimal added
              sugars. Review it against your own situation before eating from
              it.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={dontShowAgain}
            onCheckedChange={(v) => setDontShowAgain(v === true)}
          />
          Don&apos;t show this again
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleAccept}>
            I understand — continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
