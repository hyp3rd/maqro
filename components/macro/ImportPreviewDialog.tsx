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
import {
  importBundle,
  type ImportPlan,
  type ImportProgress,
} from "@/lib/import";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Plan computed by `planImport` against the parsed bundle. Render the
   *  diff counts then let the user confirm. */
  plan: ImportPlan | null;
  /** Original parsed bundle, kept around so Apply doesn't re-parse the
   *  file. Held opaque as `unknown` — `importBundle` re-validates. */
  raw: unknown;
  /** Source label shown in the header — "uploaded file" vs "cloud
   *  export 2026-05-15". */
  source: string;
  /** Fires once the apply phase has fully committed and IDB is settled.
   *  Caller is expected to either reload or rehydrate. */
  onApplied?: (result: {
    imported: ImportPlan["tables"];
    durationMs: number;
  }) => void;
};

type PhaseLabel = Exclude<ImportProgress["phase"], "done">;
const PHASE_LABELS: Record<PhaseLabel, string> = {
  profile: "Profile",
  dailyLogs: "Daily logs",
  weightHistory: "Weight history",
  customFoods: "Custom foods",
  mealTemplates: "Meal templates",
  recipes: "Recipes",
};
const PHASE_ORDER: readonly PhaseLabel[] = [
  "profile",
  "dailyLogs",
  "weightHistory",
  "customFoods",
  "mealTemplates",
  "recipes",
];

function totalChanges(plan: ImportPlan): number {
  let n = 0;
  if (
    plan.tables.profile.kind === "new" ||
    plan.tables.profile.kind === "updated"
  ) {
    n++;
  }
  for (const key of [
    "dailyLogs",
    "weightEntries",
    "customFoods",
    "mealTemplates",
    "recipes",
  ] as const) {
    n += plan.tables[key].new + plan.tables[key].updated;
  }
  return n;
}

function totalSkipped(plan: ImportPlan): number {
  let n = plan.tables.profile.kind === "skipped" ? 1 : 0;
  for (const key of [
    "dailyLogs",
    "weightEntries",
    "customFoods",
    "mealTemplates",
    "recipes",
  ] as const) {
    n += plan.tables[key].skipped;
  }
  return n;
}

export function ImportPreviewDialog({
  open,
  onOpenChange,
  plan,
  raw,
  source,
  onApplied,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-lg">
        {plan && open && (
          <ImportPreviewBody
            plan={plan}
            raw={raw}
            source={source}
            onClose={() => onOpenChange(false)}
            onApplied={onApplied}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportPreviewBody({
  plan,
  raw,
  source,
  onClose,
  onApplied,
}: {
  plan: ImportPlan;
  raw: unknown;
  source: string;
  onClose: () => void;
  onApplied?: Props["onApplied"];
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changes = totalChanges(plan);
  const skipped = totalSkipped(plan);
  const noop = changes === 0;

  async function handleApply() {
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      const result = await importBundle(raw, (e) => setProgress(e));
      const durationMs = Math.round(performance.now() - t0);
      onApplied?.({
        imported: {
          profile: plan.tables.profile,
          dailyLogs: { ...plan.tables.dailyLogs },
          weightEntries: { ...plan.tables.weightEntries },
          customFoods: { ...plan.tables.customFoods },
          mealTemplates: { ...plan.tables.mealTemplates },
          recipes: { ...plan.tables.recipes },
        },
        durationMs,
      });
      // Sanity check — should never disagree with the plan in normal use.
      if (result.skipped.length !== skipped) {
        console.warn(
          "import: skipped count drifted from plan",
          result.skipped.length,
          skipped,
        );
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Review changes</DialogTitle>
        <DialogDescription>
          From {source}. {changes} row{changes === 1 ? "" : "s"} will change
          {skipped > 0 ? `, ${skipped} skipped` : ""}.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-2">
        {/* Profile row — singleton, so its diff is one tag, not counts. */}
        <DiffRow
          label="Profile"
          kind={
            plan.tables.profile.kind === "absent"
              ? "absent"
              : plan.tables.profile.kind
          }
          highlight={plan.tables.profile.kind === "updated"}
        />
        {PHASE_ORDER.filter((p) => p !== "profile").map((p) => {
          const t =
            p === "weightHistory"
              ? plan.tables.weightEntries
              : plan.tables[
                  p as Exclude<PhaseLabel, "profile" | "weightHistory">
                ];
          return (
            <CountRow
              key={p}
              label={PHASE_LABELS[p]}
              t={t}
              highlight={t.updated > 0}
            />
          );
        })}

        {noop && !busy && (
          <p className="px-1 pt-2 text-center text-xs text-muted-foreground">
            Nothing to change — every row in the bundle already matches local.
          </p>
        )}

        {busy && progress && (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="font-mono">
              {progress.phase === "done"
                ? "Finishing…"
                : `Applying ${PHASE_LABELS[progress.phase as PhaseLabel]} — ${progress.rows}/${progress.total}`}
            </span>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="text-xs text-destructive"
          >
            {error}
          </p>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleApply}
          disabled={busy || noop}
        >
          {busy ? "Applying…" : noop ? "No changes" : "Apply"}
        </Button>
      </DialogFooter>
    </>
  );
}

function DiffRow({
  label,
  kind,
  highlight,
}: {
  label: string;
  kind: "absent" | "new" | "updated" | "unchanged" | "skipped";
  highlight: boolean;
}) {
  const tone =
    kind === "updated"
      ? "text-amber-700 dark:text-amber-400"
      : kind === "new"
        ? "text-foreground"
        : kind === "skipped"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <div
      className={
        "flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs " +
        (highlight ? "bg-amber-500/5" : "")
      }
    >
      <span className="font-medium">{label}</span>
      <span className={"font-mono " + tone}>
        {kind === "absent" ? "—" : kind}
      </span>
    </div>
  );
}

function CountRow({
  label,
  t,
  highlight,
}: {
  label: string;
  t: { new: number; updated: number; unchanged: number; skipped: number };
  highlight: boolean;
}) {
  const total = t.new + t.updated + t.unchanged + t.skipped;
  return (
    <div
      className={
        "flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs " +
        (highlight ? "bg-amber-500/5" : "")
      }
    >
      <span className="font-medium">{label}</span>
      <span className="font-mono tabular-nums text-muted-foreground">
        {total === 0 ? (
          <span>—</span>
        ) : (
          <>
            {t.new > 0 && <span className="text-foreground">{t.new} new</span>}
            {t.new > 0 && (t.updated > 0 || t.unchanged > 0) && " · "}
            {t.updated > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {t.updated} updated
              </span>
            )}
            {t.updated > 0 && t.unchanged > 0 && " · "}
            {t.unchanged > 0 && <span>{t.unchanged} unchanged</span>}
            {t.skipped > 0 && (
              <span className="text-destructive"> · {t.skipped} skipped</span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
