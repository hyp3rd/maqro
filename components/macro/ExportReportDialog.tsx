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
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { FileDown } from "lucide-react";
import { useRouter } from "next/navigation";

/** Pre-flight options for the Progress → PDF flow.
 *
 *  The first iteration of this feature called `window.print()`
 *  directly on the live /progress view, which produced a poor PDF:
 *  form inputs (the Log weigh-in date field, the body-measurement
 *  fields) landed in the document, the page got truncated mid-
 *  section, and the user had no say in what to include. This
 *  dialog moves the choice to the user: pick a date window, pick
 *  which sections, add an optional title + cover note (useful when
 *  handing the PDF to a clinician), then we open a dedicated
 *  `/report` route that renders a print-optimised layout and
 *  triggers the browser's print dialog from there.
 *
 *  Why a separate route over an in-place toggle: the print preview
 *  shows the user exactly what they'll get, and the dedicated
 *  route can be shared / bookmarked / re-printed without touching
 *  app state. */

const RANGES = {
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "60d": { label: "Last 60 days", days: 60 },
  "90d": { label: "Last 90 days", days: 90 },
} as const;
type RangeKey = keyof typeof RANGES;

export const REPORT_SECTIONS = {
  summary: "Weekly summary (streak, adherence, averages)",
  trends: "Trends (plateau + TDEE calibration advisories)",
  weight: "Weight chart + delta",
  body: "Body measurements + body-fat estimate",
  calories: "Calorie adherence chart",
  micronutrients: "Micronutrients (vitamins, minerals, fiber vs DV)",
} as const;
export type SectionKey = keyof typeof REPORT_SECTIONS;

const DEFAULT_SECTIONS: SectionKey[] = [
  "summary",
  "trends",
  "weight",
  "body",
  "calories",
  "micronutrients",
];

export function ExportReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-lg">
        {open && <DialogBody onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({
  onOpenChange,
}: {
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>("60d");
  const [sections, setSections] = useState<Set<SectionKey>>(
    () => new Set(DEFAULT_SECTIONS),
  );
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  function toggleSection(key: SectionKey) {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function generate() {
    const params = new URLSearchParams();
    params.set("days", String(RANGES[range].days));
    params.set("sections", Array.from(sections).join(",") || "none");
    if (title.trim()) params.set("title", title.trim().slice(0, 200));
    if (note.trim()) params.set("note", note.trim().slice(0, 1000));
    router.push(`/report?${params.toString()}`);
  }

  const allSectionKeys = Object.keys(REPORT_SECTIONS) as SectionKey[];
  const anyChecked = sections.size > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileDown className="h-4 w-4 text-muted-foreground" />
          Export progress report
        </DialogTitle>
        <DialogDescription>
          We&apos;ll open a print-ready report in a new view. From there your
          browser&apos;s print dialog lets you save it as a PDF, send to a
          printer, or share.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <section className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            Date range
          </Label>
          <div
            role="radiogroup"
            aria-label="Date range"
            className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
          >
            {(Object.keys(RANGES) as RangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={range === key}
                onClick={() => setRange(key)}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  range === key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {RANGES[key].label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            Sections to include
          </Label>
          <ul className="space-y-1.5 rounded-md border border-border/60 bg-card px-3 py-2.5">
            {allSectionKeys.map((key) => (
              <li
                key={key}
                className="flex items-start gap-2"
              >
                <input
                  type="checkbox"
                  id={`section-${key}`}
                  checked={sections.has(key)}
                  onChange={() => toggleSection(key)}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <Label
                  htmlFor={`section-${key}`}
                  className="cursor-pointer text-xs font-normal text-foreground"
                >
                  {REPORT_SECTIONS[key]}
                </Label>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1.5">
          <Label
            htmlFor="report-title"
            className="text-xs font-medium text-muted-foreground"
          >
            Title (optional)
          </Label>
          <Input
            id="report-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={'e.g. "Q2 2026 progress for Dr. Smith"'}
            maxLength={200}
          />
        </section>

        <section className="space-y-1.5">
          <Label
            htmlFor="report-note"
            className="text-xs font-medium text-muted-foreground"
          >
            Cover note (optional)
          </Label>
          <Textarea
            id="report-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Context for the recipient — current goals, recent changes, what to focus on."
            rows={3}
            maxLength={1000}
          />
          <p className="text-[10px] text-muted-foreground">
            {note.length} / 1000 characters
          </p>
        </section>
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={generate}
          disabled={!anyChecked}
          className="gap-1.5"
        >
          <FileDown className="h-3.5 w-3.5" />
          Generate report
        </Button>
      </DialogFooter>
    </>
  );
}
