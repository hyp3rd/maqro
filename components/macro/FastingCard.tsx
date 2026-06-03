"use client";

import { useFastingStatus } from "@/hooks/use-fasting-status";
import { useNow } from "@/hooks/use-now";
import {
  eatingHours,
  formatDuration,
  PROTOCOLS,
  type FastingProtocol,
} from "@/lib/fasting";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  ChevronRight,
  Hourglass,
  Pencil,
  Play,
  Square,
  Utensils,
} from "lucide-react";
import type { ViewKey } from "../shell/Sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

/** Local wall-clock formatter — "7:40 PM". */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Epoch → the `YYYY-MM-DDTHH:mm` local string a `datetime-local` input wants. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PROTOCOL_LABEL: Record<FastingProtocol, string> = {
  "16:8": "16:8",
  "18:6": "18:6",
  "20:4": "20:4",
  custom: "Custom",
};

/** The live intermittent-fasting card on the day view (today only). Single
 *  home for fasting config + status: protocol picker plus a manual fast you
 *  Start, Stop (with a confirm), and whose start time you can edit. The fast
 *  is deliberately independent of food logging — adding, planning, or editing
 *  meals never moves it. Self-contained via `useFastingStatus`. */
export function FastingCard({
  onSelectView,
}: {
  /** Opens the full Fasting page (phases, education, streak breakdown). */
  onSelectView?: (key: ViewKey) => void;
}) {
  const {
    status,
    fasting,
    fastingHours,
    isHydrated,
    startFast,
    stopFast,
    setFastStart,
    updateFasting,
  } = useFastingStatus();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  // Minute-aligned clock for the edit input's max bound (avoids an impure
  // `Date.now()` during render; event handlers below still use Date.now()).
  const now = useNow();

  if (!isHydrated) return null;

  // Disabled / first-run: a compact prompt rather than the full timer.
  if (!fasting?.enabled) {
    return (
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Hourglass className="h-4 w-4 text-indigo-500" />
          Fasting
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() =>
            void updateFasting({ enabled: true, protocol: "16:8" })
          }
        >
          <Play className="h-3.5 w-3.5" />
          Track an eating window
        </Button>
      </div>
    );
  }

  const eatHrs = eatingHours(fasting);
  const isFasting = status.phase === "fasting";

  function openEdit() {
    setDraft(toLocalInput(status.fastStartedAt ?? Date.now()));
    setEditing(true);
  }
  function saveEdit() {
    const ms = new Date(draft).getTime();
    if (Number.isFinite(ms) && ms <= Date.now()) void setFastStart(ms);
    setEditing(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Hourglass className="h-4 w-4 text-indigo-500" />
          Fasting
        </h3>
        <Select
          value={fasting.protocol}
          onValueChange={(v) =>
            void updateFasting({ protocol: v as FastingProtocol })
          }
        >
          <SelectTrigger className="h-8 w-[5.5rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROTOCOLS.map((p) => (
              <SelectItem
                key={p}
                value={p}
                className="text-xs"
              >
                {PROTOCOL_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {fasting.protocol === "custom" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Fast for
          <input
            type="number"
            inputMode="numeric"
            min={12}
            max={23}
            value={fastingHours}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n))
                void updateFasting({ customFastingHours: n });
            }}
            className="h-7 w-16 rounded-md border border-border/60 bg-card px-2 text-center font-mono text-foreground"
          />
          hours
        </label>
      )}

      {/* Status line — phase-dependent headline. */}
      {status.phase === "none" ? (
        <p className="text-sm text-muted-foreground">
          No fast running — tap Start fast now to begin the timer.
        </p>
      ) : (
        <>
          <p className="font-mono text-sm tabular-nums">
            {isFasting ? (
              <>
                <span className="text-muted-foreground">
                  Eating window opens in{" "}
                </span>
                <span className="font-semibold text-foreground">
                  {formatDuration(status.remainingMin)}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                <Utensils className="h-3.5 w-3.5" />
                Eating window open
              </span>
            )}
          </p>

          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(status.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress toward the fasting target"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                status.phase === "eating" ? "bg-emerald-500" : "bg-indigo-500",
              )}
              style={{ width: `${Math.round(status.progress * 100)}%` }}
            />
          </div>

          <p className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
            <span>
              {isFasting
                ? `Fasting ${formatDuration(status.elapsedMin)}`
                : `Window open ${formatDuration(status.elapsedMin)} · ${eatHrs}h target`}
              {status.fastStartedAt !== null && (
                <> · since {clock(status.fastStartedAt)}</>
              )}
            </span>
            {isFasting && !editing && (
              <button
                type="button"
                onClick={openEdit}
                aria-label="Edit fast start time"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </p>

          {editing && (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="datetime-local"
                max={toLocalInput(now)}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-7 rounded-md border border-border/60 bg-card px-2 text-xs text-foreground"
                aria-label="Fast start time"
              />
              <Button
                type="button"
                size="sm"
                className="h-7"
                onClick={saveEdit}
              >
                Done
              </Button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {/* Start / Stop + links. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isFasting ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setConfirmStop(true)}
          >
            <Square className="h-3.5 w-3.5" />
            Stop fasting now
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void startFast()}
          >
            <Play className="h-3.5 w-3.5" />
            Start fast now
          </Button>
        )}
        {onSelectView && (
          <button
            type="button"
            onClick={() => onSelectView("fasting")}
            className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400"
          >
            View phases &amp; details
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void updateFasting({ enabled: false })}
          className={cn(
            "text-[11px] text-muted-foreground transition-colors hover:text-foreground",
            !onSelectView && "ml-auto",
          )}
        >
          Turn off
        </button>
      </div>

      <AlertDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop your fast?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends the current fast at {formatDuration(status.elapsedMin)}.
              You can start a new one anytime — your logged meals aren&apos;t
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep fasting</AlertDialogCancel>
            <AlertDialogAction onClick={() => void stopFast()}>
              Stop fasting
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
