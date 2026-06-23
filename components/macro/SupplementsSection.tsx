"use client";

import { useAiUsage } from "@/hooks/use-ai-usage";
import { useNotificationPrefs } from "@/hooks/use-notification-prefs";
import { FEATURES } from "@/lib/billing/tiers";
import {
  addSupplement,
  deleteSupplement,
  getSupplementIntake,
  listSupplements,
  saveSupplementIntake,
  todayKey,
  upsertSupplement,
  type Supplement,
  type SupplementIntakeEntry,
} from "@/lib/db";
import {
  MICRONUTRIENT_KEYS,
  MICRONUTRIENTS,
  type MicronutrientKey,
  type MicronutrientValues,
} from "@/lib/rda";
import { useDataRev } from "@/lib/sync/data-bus";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { Info, Minus, Pill, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Supplements card on the Progress view (Pro, alongside Micronutrients). Log a
 *  supplement and its per-dose nutrients feed the daily micronutrient totals;
 *  an optional schedule drives in-app + email reminders. Non-Pro users see
 *  nothing here — the Micronutrients upgrade card already sells the Pro micro
 *  suite, so a second prompt would be redundant. */
export function SupplementsSection() {
  const { state } = useAiUsage();
  const isPro =
    state.status === "ok" && FEATURES.canTrackMicronutrients(state.data.tier);

  const [supplements, setSupplements] = useState<Supplement[] | null>(null);
  const [takenToday, setTakenToday] = useState<SupplementIntakeEntry[]>([]);
  const [editing, setEditing] = useState<Supplement | "new" | null>(null);
  const supplementsRev = useDataRev("supplements");
  const intakeRev = useDataRev("supplementIntake");
  const today = useMemo(() => todayKey(), []);

  useEffect(() => {
    if (!isPro) return;
    let cancelled = false;
    listSupplements()
      .then((rows) => {
        if (!cancelled) setSupplements(rows);
      })
      .catch(() => {
        if (!cancelled) setSupplements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isPro, supplementsRev]);

  useEffect(() => {
    if (!isPro) return;
    let cancelled = false;
    getSupplementIntake(today)
      .then((rec) => {
        if (!cancelled) setTakenToday(rec?.taken ?? []);
      })
      .catch(() => {
        if (!cancelled) setTakenToday([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isPro, today, intakeRev]);

  if (!isPro) return null;

  const dosesFor = (id: string) =>
    takenToday.find((t) => t.supplementId === id)?.doses ?? 0;

  async function setDoses(id: string, doses: number) {
    // Compute the next intake off the LATEST state via the functional updater,
    // so rapid taps / a concurrent edit to another supplement don't clobber
    // each other with a stale array.
    let next: SupplementIntakeEntry[] = [];
    setTakenToday((prev) => {
      next = prev
        .filter((t) => t.supplementId !== id)
        .concat(doses > 0 ? [{ supplementId: id, doses }] : []);
      return next;
    });
    try {
      await saveSupplementIntake(today, next);
    } catch {
      toast.error("Couldn't save what you took. Try again.");
    }
  }

  async function remove(id: string) {
    try {
      await deleteSupplement(id);
      // Drop it from today's intake so the totals don't reference a deleted
      // supplement. `setDoses(id, 0)` reads the latest state, so this is safe
      // even if it wasn't logged today (a no-op rewrite).
      await setDoses(id, 0);
      toast.success("Supplement removed.");
    } catch {
      toast.error("Couldn't remove it. Try again.");
    }
  }

  const list = supplements ?? [];

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Pill className="h-4 w-4 text-brand" />
          Supplements
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Log what you take so it counts toward your micronutrient totals.
        </p>
      </header>

      {/* Disclaimer — supportive, not promotional. */}
      <div className="flex items-start gap-2.5 border-b border-border/60 bg-muted/20 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          This is here to help you track supplements you already take — for a
          deficiency, a clinician's advice, or a genuine gap in your diet. It is
          not a nudge to start supplementing. Whole foods cover most needs;
          consider a professional before adding anything.
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        {list.length === 0 && editing === null && (
          <p className="text-sm text-muted-foreground">
            No supplements yet. Add one to log it and feed its nutrients into
            your totals.
          </p>
        )}

        {/* Library + today's doses */}
        {list.length > 0 && (
          <ul className="space-y-2">
            {list.map((s) => {
              const doses = dosesFor(s.id);
              const nutrients = (Object.keys(s.micros) as MicronutrientKey[])
                .filter((k) => typeof s.micros[k] === "number")
                .map((k) => MICRONUTRIENTS[k].label);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-border/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {s.name}
                      {s.doseLabel && (
                        <span className="ml-2 font-normal text-muted-foreground">
                          {s.doseLabel}
                        </span>
                      )}
                    </p>
                    {nutrients.length > 0 && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {nutrients.join(" · ")}
                        {s.schedule && s.schedule.reminderTimes.length > 0 && (
                          <>
                            {" · "}reminds{" "}
                            {s.schedule.reminderTimes
                              .slice()
                              .sort((a, b) => a - b)
                              .map((h) => `${h}:00`)
                              .join(", ")}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Today's dose stepper */}
                    <div className="flex items-center rounded-md border border-border/60">
                      <button
                        type="button"
                        aria-label={`Fewer doses of ${s.name}`}
                        disabled={doses <= 0}
                        onClick={() =>
                          void setDoses(s.id, Math.max(0, doses - 1))
                        }
                        className="flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center font-mono text-sm tabular-nums">
                        {doses}
                      </span>
                      <button
                        type="button"
                        aria-label={`More doses of ${s.name}`}
                        onClick={() => void setDoses(s.id, doses + 1)}
                        className="flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${s.name}`}
                      onClick={() => void remove(s.id)}
                      className="text-muted-foreground transition-colors hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Add / edit form, or the "Add" affordance */}
        {editing !== null ? (
          <SupplementForm
            initial={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setEditing("new")}
          >
            <Plus className="h-3.5 w-3.5" />
            Add a supplement
          </Button>
        )}

        <ReminderToggle />
      </div>
    </section>
  );
}

/** The master supplement-reminders opt-in (email + push). Per-supplement times
 *  live on each supplement's schedule; this is the on/off switch. */
function ReminderToggle() {
  const { state, update } = useNotificationPrefs();
  if (state.status !== "ok") return null;
  const { supplementReminders } = state.data;
  return (
    <label className="flex items-start gap-2 border-t border-border/60 pt-3 text-xs">
      <input
        type="checkbox"
        checked={supplementReminders}
        onChange={(e) => void update({ supplementReminders: e.target.checked })}
        className="mt-0.5 h-3.5 w-3.5 rounded border-border"
      />
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">Reminders</span> — get a
        nudge (in-app + email) at the times set on each supplement. Turn this
        off to silence all of them at once.
      </span>
    </label>
  );
}

/** Add / edit a supplement: name, dose label, per-dose nutrient amounts, and an
 *  optional reminder schedule. */
function SupplementForm({
  initial,
  onClose,
}: {
  initial: Supplement | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [doseLabel, setDoseLabel] = useState(initial?.doseLabel ?? "");
  const [micros, setMicros] = useState<MicronutrientValues>(
    initial?.micros ?? {},
  );
  const [remind, setRemind] = useState(
    (initial?.schedule?.reminderTimes.length ?? 0) > 0,
  );
  const [times, setTimes] = useState<number[]>(
    initial?.schedule?.reminderTimes ?? [],
  );
  const [days, setDays] = useState<number[]>(
    initial?.schedule?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
  );
  const [hourPick, setHourPick] = useState(9);
  const [saving, setSaving] = useState(false);

  function setMicro(key: MicronutrientKey, raw: string) {
    const v = Number.parseFloat(raw);
    setMicros((m) => {
      const next = { ...m };
      if (raw.trim() === "" || !Number.isFinite(v) || v <= 0) delete next[key];
      else next[key] = v;
      return next;
    });
  }

  function addTime() {
    setTimes((t) => (t.includes(hourPick) ? t : [...t, hourPick]));
  }

  async function save() {
    const trimmed = name.trim();
    if (trimmed === "") {
      toast.error("Give the supplement a name.");
      return;
    }
    const schedule =
      remind && times.length > 0 && days.length > 0
        ? { reminderTimes: times, daysOfWeek: days }
        : undefined;
    setSaving(true);
    try {
      if (initial) {
        await upsertSupplement({
          ...initial,
          name: trimmed,
          doseLabel: doseLabel.trim(),
          micros,
          schedule,
        });
      } else {
        await addSupplement({
          name: trimmed,
          doseLabel: doseLabel.trim(),
          micros,
          schedule,
        });
      }
      onClose();
    } catch {
      toast.error("Couldn't save the supplement. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 px-4 py-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="supp-name">Name</Label>
          <Input
            id="supp-name"
            value={name}
            placeholder="e.g. Vitamin D3"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="supp-dose">Dose label (optional)</Label>
          <Input
            id="supp-dose"
            value={doseLabel}
            placeholder="e.g. 1000 IU · 1 capsule"
            onChange={(e) => setDoseLabel(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Nutrients per dose</Label>
        <p className="text-[11px] text-muted-foreground">
          Enter the amounts on the label — leave the rest blank.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MICRONUTRIENT_KEYS.map((key) => (
            <label
              key={key}
              className="flex items-center gap-1.5 text-xs"
            >
              <span className="w-20 shrink-0 truncate text-muted-foreground">
                {MICRONUTRIENTS[key].label}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={micros[key] ?? ""}
                onChange={(e) => setMicro(key, e.target.value)}
                className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="w-6 shrink-0 text-[10px] text-muted-foreground">
                {MICRONUTRIENTS[key].unit}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Optional reminder schedule */}
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={remind}
          onChange={(e) => setRemind(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border"
        />
        Remind me to take this
      </label>
      {remind && (
        <div className="space-y-2 pl-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {times
              .slice()
              .sort((a, b) => a - b)
              .map((h) => (
                <span
                  key={h}
                  className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card px-2 py-0.5 text-[11px]"
                >
                  {h.toString().padStart(2, "0")}:00
                  <button
                    type="button"
                    aria-label={`Remove ${h}:00`}
                    onClick={() => setTimes((t) => t.filter((x) => x !== h))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            <select
              value={hourPick}
              onChange={(e) => setHourPick(Number.parseInt(e.target.value, 10))}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option
                  key={h}
                  value={h}
                >
                  {h.toString().padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addTime}
              className="text-xs font-medium text-brand hover:underline"
            >
              Add time
            </button>
          </div>
          <div className="flex items-center gap-1">
            {WEEKDAY_LABELS.map((label, i) => {
              const on = days.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Toggle ${WEEKDAY_FULL[i]}`}
                  onClick={() =>
                    setDays((d) =>
                      d.includes(i)
                        ? d.filter((x) => x !== i)
                        : [...d, i].sort((a, b) => a - b),
                    )
                  }
                  className={cn(
                    "h-7 w-7 rounded-full text-xs font-medium transition-colors",
                    on
                      ? "bg-brand text-brand-foreground"
                      : "border border-border/60 text-muted-foreground hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={saving}
          onClick={() => void save()}
        >
          {initial ? "Save" : "Add"}
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
