import { normalizeProteinSetting, normalizeTrainingSchedule } from "./training";
import type {
  CyclingPreset,
  ProteinSetting,
  TrainingDay,
  TrainingSchedule,
  WorkoutMealSettings,
} from "./types";

/** Writes for the profile's optional `training` template and
 *  `proteinSetting` — the editor's counterpart of the read-time
 *  `normalizeTrainingSchedule` / `normalizeProteinSetting`.
 *
 *  `profiles.payload` is shared by every client version, and a read
 *  normalizes away whatever this build doesn't know (a newer session type,
 *  a new key). An edit therefore starts from the STORED value, not the
 *  normalized one: it changes exactly the field the user edited and keeps
 *  everything else as stored, so editing Monday never rewrites a newer
 *  client's Wednesday. Only when there is no usable template at all does an
 *  edit start from `defaultTrainingSchedule()`. Pure; never mutates its
 *  input. */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The week a first enable seeds (indexed by `getDay()`, 0 = Sunday): three
 *  strength sessions on alternate weekdays and a light endurance session
 *  on Saturday, around three rest days, planned with the default `modest`
 *  cycling. A starting point the user edits, not a programme. */
export function defaultTrainingSchedule(): TrainingSchedule {
  return {
    enabled: true,
    cycling: "modest",
    days: [
      { type: "rest" },
      { type: "upper", intensity: "moderate", time: "18:00", durationMin: 60 },
      { type: "rest" },
      { type: "lower", intensity: "moderate", time: "18:00", durationMin: 60 },
      { type: "rest" },
      {
        type: "fullBody",
        intensity: "moderate",
        time: "18:00",
        durationMin: 60,
      },
      { type: "endurance", intensity: "light", time: "09:00", durationMin: 45 },
    ],
  };
}

/** The stored template to edit: the raw record when it is a usable template
 *  (what `normalizeTrainingSchedule` accepts), else the seeded default. */
function editable(
  raw: unknown,
): Record<string, unknown> & { days: readonly unknown[] } {
  if (normalizeTrainingSchedule(raw) !== null && isRecord(raw)) {
    return { ...raw, days: raw.days as readonly unknown[] };
  }
  return defaultTrainingSchedule();
}

/** The stored template with `patch` applied. Its entries are what was
 *  stored (possibly from a newer client) plus this edit: typed as the
 *  schedule because every reader goes through `normalizeTrainingSchedule`,
 *  which is what makes the untouched entries safe to carry along. */
function patched(
  raw: unknown,
  patch: (base: ReturnType<typeof editable>) => Record<string, unknown>,
): TrainingSchedule {
  return patch(editable(raw)) as TrainingSchedule;
}

/** Turn the schedule on or off. The template is kept either way, so turning
 *  it back on restores the user's week; the first enable seeds the default
 *  week. */
export function withTrainingEnabled(
  raw: unknown,
  enabled: boolean,
): TrainingSchedule {
  return patched(raw, (base) => ({ ...base, enabled }));
}

const DAY_FIELDS = ["type", "intensity", "time", "durationMin"] as const;

/** Replace one weekday's session (`weekday` = `getDay()`, 0 = Sunday). The
 *  day's known fields become exactly `day` (an optional field it leaves out
 *  is cleared); keys this build doesn't know stay, and so does every other
 *  day. */
export function withTrainingDay(
  raw: unknown,
  weekday: number,
  day: TrainingDay,
): TrainingSchedule {
  return patched(raw, (base) => {
    const days = [...base.days];
    const stored = days[weekday];
    const next: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
    for (const field of DAY_FIELDS) delete next[field];
    days[weekday] = { ...next, ...day };
    return { ...base, days };
  });
}

/** Set how far calories move between days. */
export function withTrainingCycling(
  raw: unknown,
  cycling: CyclingPreset,
): TrainingSchedule {
  return patched(raw, (base) => ({ ...base, cycling }));
}

/** Set which workout meals training days get; keys this build doesn't know
 *  (inside `workoutMeals` too) stay. */
export function withWorkoutMeals(
  raw: unknown,
  settings: WorkoutMealSettings,
): TrainingSchedule {
  return patched(raw, (base) => ({
    ...base,
    workoutMeals: {
      ...(isRecord(base.workoutMeals) ? base.workoutMeals : {}),
      pre: settings.pre,
      post: settings.post,
    },
  }));
}

/** Set the fixed-protein setting: g/kg on the 0.1 grid the editor steps on,
 *  clamped into the basis' safe range (`normalizeProteinSetting`); keys this
 *  build doesn't know stay. */
export function withProteinSetting(
  raw: unknown,
  setting: ProteinSetting,
): ProteinSetting {
  const valid = normalizeProteinSetting({
    basis: setting.basis,
    gPerKg: Math.round(setting.gPerKg * 10) / 10,
  });
  return { ...(isRecord(raw) ? raw : {}), ...valid };
}
