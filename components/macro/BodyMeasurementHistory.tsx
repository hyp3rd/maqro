"use client";

import type { PersonalInfo } from "@/components/macro/types";
import { bodyFatCategory, estimateBodyFat } from "@/lib/body-fat";
import { type BodyMeasurement, listBodyMeasurements } from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { cmToInches, type UnitSystem } from "@/lib/units";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Section } from "./FormFields";

/** `YYYY-MM-DD` → "13 May" in the user's locale, parsed as a local date. */
function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** Read-only archive of body measurements (waist / neck / hips + the body-fat
 *  estimate they produce). Entry lives in Progress — this is Profile's
 *  at-a-glance history, re-fetched live on every sync notification.
 *
 *  `onGoToProgress`, when provided, renders a shortcut to the Progress view
 *  where the measurements are actually logged. */
export function BodyMeasurementHistory({
  gender,
  heightCm,
  units,
  onGoToProgress,
}: {
  gender: PersonalInfo["gender"];
  heightCm: number;
  units: UnitSystem;
  onGoToProgress?: () => void;
}) {
  const rev = useDataRev("bodyMeasurements");
  const [entries, setEntries] = useState<BodyMeasurement[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBodyMeasurements()
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

  // Body-fat needs a gendered formula; nonbinary / prefer-not-to-say have no
  // published Navy formula, so we skip the estimate for them.
  const bodyType = gender === "male" || gender === "female" ? gender : null;
  const unitLabel = units === "imperial" ? "in" : "cm";
  const fmtLen = (cm: number): string =>
    units === "imperial" ? cmToInches(cm).toFixed(1) : String(Math.round(cm));

  const recent = entries ? [...entries].reverse() : [];

  return (
    <Section
      title="Body measurements"
      description="Waist, neck and hips, plus the body-fat estimate they produce. Logged in Progress."
    >
      {entries === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No measurements yet.
          {onGoToProgress && (
            <>
              {" "}
              <button
                type="button"
                onClick={onGoToProgress}
                className="font-medium text-brand hover:underline"
              >
                Log your first in Progress
              </button>
              .
            </>
          )}
        </p>
      ) : (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {recent.map((e) => {
            const parts: string[] = [];
            if (e.waistCm != null) parts.push(`W ${fmtLen(e.waistCm)}`);
            if (e.neckCm != null) parts.push(`N ${fmtLen(e.neckCm)}`);
            if (e.hipsCm != null) parts.push(`H ${fmtLen(e.hipsCm)}`);
            const bf =
              bodyType && e.waistCm != null && e.neckCm != null
                ? estimateBodyFat({
                    bodyType,
                    heightCm,
                    waistCm: e.waistCm,
                    neckCm: e.neckCm,
                    hipCm: e.hipsCm,
                  })
                : null;
            return (
              <li
                key={e.date}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {fmtDate(e.date)}
                  </span>
                  <span className="text-sm tabular-nums text-foreground">
                    {parts.join(" · ")}
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {unitLabel}
                    </span>
                  </span>
                  {bf != null && (
                    <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand">
                      {bf}% · {bodyType ? bodyFatCategory(bf, bodyType) : ""}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {onGoToProgress && recent.length > 0 && (
        <button
          type="button"
          onClick={onGoToProgress}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          Add or edit in Progress
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </Section>
  );
}

export default BodyMeasurementHistory;
