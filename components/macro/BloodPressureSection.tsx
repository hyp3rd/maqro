"use client";

import { useToday } from "@/hooks/use-today";
import {
  BLOOD_PRESSURE_LABELS,
  type BloodPressureCategory,
  bloodPressureCategory,
} from "@/lib/blood-pressure";
import {
  type BloodPressure,
  deleteBloodPressure,
  listBloodPressure,
  saveBloodPressure,
} from "@/lib/db";
import { reportStorageError, reportStorageOk } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Field, Section } from "./FormFields";

// Plausibility bounds — mirror the CHECK constraints in
// supabase/migrations/0057_blood_pressure.sql so the client rejects the same
// garbage the server would.
const SYS_MIN = 50;
const SYS_MAX = 300;
const DIA_MIN = 30;
const DIA_MAX = 200;
const PULSE_MIN = 20;
const PULSE_MAX = 300;

const CATEGORY_CLASS: Record<BloodPressureCategory, string> = {
  low: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  normal: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  elevated: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  stage1: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  stage2: "bg-red-500/10 text-red-600 dark:text-red-400",
  crisis: "bg-red-600/15 text-red-700 dark:text-red-300",
};

/** `YYYY-MM-DD` → "13 May" in the user's locale. Parsed as a local date
 *  (not `new Date(iso)`, which is UTC) so the day never shifts by one. */
function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function parseNum(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Blood-pressure log + history. Self-contained: reads its own entries from
 *  IDB and re-fetches on every sync notification, so it stays live without the
 *  parent threading state through. Storage is mmHg; readings are date-keyed
 *  (one per day, last-write-wins) like body measurements. */
export function BloodPressureSection() {
  const today = useToday();
  const rev = useDataRev("bloodPressure");
  const [entries, setEntries] = useState<BloodPressure[] | null>(null);

  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBloodPressure()
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e) => {
        reportStorageError(e);
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rev]);

  async function refresh() {
    setEntries(await listBloodPressure());
  }

  async function save() {
    setError(null);
    const sys = parseNum(systolic);
    const dia = parseNum(diastolic);
    if (sys === null || dia === null) {
      setError("Enter both systolic and diastolic.");
      return;
    }
    if (sys < SYS_MIN || sys > SYS_MAX || dia < DIA_MIN || dia > DIA_MAX) {
      setError("Enter a realistic reading (e.g. 120 / 80).");
      return;
    }
    if (dia >= sys) {
      setError("Systolic (top) should be higher than diastolic (bottom).");
      return;
    }
    const pul = parseNum(pulse);
    if (pul !== null && (pul < PULSE_MIN || pul > PULSE_MAX)) {
      setError("Pulse looks off — leave it blank if unsure.");
      return;
    }
    setSaving(true);
    try {
      await saveBloodPressure(date, {
        systolic: sys,
        diastolic: dia,
        pulse: pul ?? undefined,
        notes: notes.trim() === "" ? undefined : notes.trim(),
      });
      reportStorageOk();
      bumpPending();
      // Fresh slate for the next reading; keep the picked date.
      setSystolic("");
      setDiastolic("");
      setPulse("");
      setNotes("");
      await refresh();
    } catch (e) {
      reportStorageError(e);
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(d: string) {
    try {
      await deleteBloodPressure(d);
      reportStorageOk();
      bumpPending();
      await refresh();
    } catch (e) {
      reportStorageError(e);
    }
  }

  // Most-recent first for the history list (storage is oldest-first).
  const recent = entries ? [...entries].reverse() : [];

  return (
    <Section
      title="Blood pressure"
      description="Log systolic / diastolic (mmHg) with an optional pulse. Same-day entries overwrite."
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field
          id="bp-systolic"
          label="Systolic"
        >
          <Input
            id="bp-systolic"
            type="number"
            inputMode="numeric"
            min={SYS_MIN}
            max={SYS_MAX}
            placeholder="120"
            value={systolic}
            onChange={(e) => setSystolic(e.target.value)}
          />
        </Field>
        <Field
          id="bp-diastolic"
          label="Diastolic"
        >
          <Input
            id="bp-diastolic"
            type="number"
            inputMode="numeric"
            min={DIA_MIN}
            max={DIA_MAX}
            placeholder="80"
            value={diastolic}
            onChange={(e) => setDiastolic(e.target.value)}
          />
        </Field>
        <Field
          id="bp-pulse"
          label="Pulse (bpm)"
        >
          <Input
            id="bp-pulse"
            type="number"
            inputMode="numeric"
            min={PULSE_MIN}
            max={PULSE_MAX}
            placeholder="optional"
            value={pulse}
            onChange={(e) => setPulse(e.target.value)}
          />
        </Field>
        <Field
          id="bp-date"
          label="Date"
        >
          <Input
            id="bp-date"
            type="date"
            max={today || undefined}
            value={date}
            onChange={(e) => setPicked(e.target.value)}
            className="font-mono tabular-nums"
          />
        </Field>
      </div>

      <Field
        id="bp-notes"
        label="Notes (optional)"
      >
        <Input
          id="bp-notes"
          type="text"
          placeholder="e.g. resting, left arm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {error && (
        <p
          role="alert"
          className="text-[11px] text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <Button
        type="button"
        size="sm"
        onClick={save}
        disabled={saving}
      >
        {saving ? "Saving…" : "Log reading"}
      </Button>

      {recent.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </h4>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {recent.map((e) => {
              const cat = bloodPressureCategory(e.systolic, e.diastolic);
              return (
                <li
                  key={e.date}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
                    <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {fmtDate(e.date)}
                    </span>
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {e.systolic}/{e.diastolic}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                        mmHg
                      </span>
                    </span>
                    {e.pulse != null && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {e.pulse} bpm
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        CATEGORY_CLASS[cat],
                      )}
                    >
                      {BLOOD_PRESSURE_LABELS[cat]}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(e.date)}
                    aria-label={`Delete ${e.date} reading`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

export default BloodPressureSection;
