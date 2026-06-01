"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Info } from "lucide-react";

/** Compact "(i)" trigger that opens a Dialog with an explanation.
 *  Used inline next to acronyms / formulas in the calculator UI
 *  (BMR, TDEE, Target, etc.) so beta testers can answer "what is
 *  this number?" without leaving the page.
 *
 *  Why a Dialog over a Tooltip:
 *
 *    1. Mobile tooltips on touch devices are awkward — they need
 *       long-press, they get covered by the keyboard, they vanish
 *       on tap-outside before the user finishes reading. A Dialog
 *       is a first-class focus target with a clear close affordance.
 *    2. Explanations are multi-paragraph. Tooltips force a single
 *       line; useful for a one-liner, not for "here's what BMR is
 *       and the three caveats that go with it".
 *    3. Trigger is a button (not just an icon-styled span) so it's
 *       reachable by keyboard navigation and announced by screen
 *       readers as "More information about BMR".
 *
 *  Body content is JSX (not just a string) so callers can include
 *  formulas, bullet lists, and links to the docs / privacy page. */
export function InfoExplainer({
  title,
  ariaLabel,
  children,
}: {
  /** Modal heading. Usually the acronym being explained ("What is BMR?"). */
  title: string;
  /** What a screen reader reads when the trigger gets focus. Defaults
   *  to "More information about {title}" — pass an override only if
   *  the title is unusual phrasing. */
  ariaLabel?: string;
  /** Rich body content. Caller decides paragraphs / lists / links. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? `More information about ${title}`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3 w-3" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Info
              className="h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Explainer for {title}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
