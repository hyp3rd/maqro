import type { DailyLog } from "@/lib/db";
import {
  currentStreakDates,
  eatingWindowForDay,
  type FastStatus,
} from "@/lib/fasting";

/** Educational model of the stages a body is *generally described* as moving
 *  through during a fast. The hour bands are popular-protocol approximations,
 *  NOT clinical fact — actual timing varies widely by metabolism, the last
 *  meal, activity, and the individual. The Fasting page renders these with a
 *  prominent not-medical-advice disclaimer; this module only owns the data +
 *  the pure math that maps fast-minutes onto the bands. */

export type FastingPhaseKey =
  "fed" | "settling" | "glycogen" | "fatBurning" | "ketosis" | "autophagy";

/** A semantic accent name; the UI maps it to Tailwind classes (keeping this
 *  module free of styling). */
export type PhaseAccent =
  "amber" | "yellow" | "lime" | "teal" | "sky" | "indigo";

export type FastingPhase = {
  key: FastingPhaseKey;
  name: string;
  /** Inclusive start hour. */
  startHour: number;
  /** Exclusive end hour; `null` = open-ended (the final phase). */
  endHour: number | null;
  /** One-line summary for badges/timeline. */
  short: string;
  /** A sentence or two for the "phases explained" section. */
  detail: string;
  accent: PhaseAccent;
};

/** The ordered ladder. Bands tile `[0, ∞)` with no gaps, so any fast length
 *  maps cleanly. Start-inclusive, end-exclusive. */
export const FASTING_PHASES: readonly FastingPhase[] = [
  {
    key: "fed",
    name: "Fed",
    startHour: 0,
    endHour: 4,
    short: "Blood sugar & insulin rising",
    detail:
      "Your body is digesting and absorbing your last meal. Blood sugar and insulin rise as energy is taken up and stored — the anabolic, “fed” state.",
    accent: "amber",
  },
  {
    key: "settling",
    name: "Blood sugar settling",
    startHour: 4,
    endHour: 8,
    short: "Insulin falling, glucose settling",
    detail:
      "Absorption finishes and insulin falls back toward baseline. Blood sugar settles and your body begins leaning on stored energy rather than the meal.",
    accent: "yellow",
  },
  {
    key: "glycogen",
    name: "Glycogen use",
    startHour: 8,
    endHour: 12,
    short: "Burning stored glycogen",
    detail:
      "With insulin low, your liver releases stored glycogen to keep blood sugar steady. Those stores gradually draw down over the hours that follow.",
    accent: "lime",
  },
  {
    key: "fatBurning",
    name: "Fat burning",
    startHour: 12,
    endHour: 16,
    short: "Switching to fat for fuel",
    detail:
      "As glycogen runs low, the body shifts toward burning fat — the so-called “metabolic switch”. Fat breakdown (lipolysis) picks up to cover energy needs.",
    accent: "teal",
  },
  {
    key: "ketosis",
    name: "Ketosis",
    startHour: 16,
    endHour: 24,
    short: "Ketones rising",
    detail:
      "Fat-derived ketone bodies become a meaningful fuel for the brain and body. Many people report steadier energy and reduced hunger through this window.",
    accent: "sky",
  },
  {
    key: "autophagy",
    name: "Autophagy",
    startHour: 24,
    endHour: null,
    short: "Cellular clean-up",
    detail:
      "Cellular “clean-up” — autophagy — is thought to ramp up, recycling worn-out components. Human timing is uncertain and individual; this is the least settled, most over-claimed phase.",
    accent: "indigo",
  },
] as const;

const MIN_PER_HOUR = 60;

function emptyPhaseMinutes(): Record<FastingPhaseKey, number> {
  return {
    fed: 0,
    settling: 0,
    glycogen: 0,
    fatBurning: 0,
    ketosis: 0,
    autophagy: 0,
  };
}

/** The phase a given elapsed-fast hour count falls in. Clamps negatives to 0;
 *  the open-ended final phase catches anything past the last band. */
export function phaseAtHours(hours: number): FastingPhase {
  const h = Math.max(0, hours);
  for (const phase of FASTING_PHASES) {
    if (h >= phase.startHour && (phase.endHour === null || h < phase.endHour)) {
      return phase;
    }
  }
  return FASTING_PHASES[FASTING_PHASES.length - 1];
}

/** Minutes of a single fast of `fastMinutes` spent in each phase — the
 *  overlap of `[0, fastMinutes]` with each band. The per-phase values sum to
 *  `fastMinutes` (the bands tile the line). */
export function phaseBreakdownMinutes(
  fastMinutes: number,
): Record<FastingPhaseKey, number> {
  const total = Math.max(0, fastMinutes);
  const out = emptyPhaseMinutes();
  for (const phase of FASTING_PHASES) {
    const startMin = phase.startHour * MIN_PER_HOUR;
    const endMin =
      phase.endHour === null
        ? Number.POSITIVE_INFINITY
        : phase.endHour * MIN_PER_HOUR;
    out[phase.key] = Math.max(0, Math.min(total, endMin) - startMin);
  }
  return out;
}

/** Per-phase minute totals across the **current on-protocol streak**. Each
 *  completed streak day contributes a fast of `24h − eatingWindow`; today (if
 *  in the streak and mid-fast) contributes the live `status.elapsedMin`. Pure
 *  + time-travel-safe via `today`. */
export function streakPhaseMinutes(opts: {
  logs: DailyLog[];
  today: string;
  eatingHrs: number;
  status: FastStatus;
  graceMin?: number;
}): Record<FastingPhaseKey, number> {
  const { logs, today, eatingHrs, status, graceMin } = opts;
  const dates = currentStreakDates(logs, today, eatingHrs, graceMin);
  const byDate = new Map(logs.map((log) => [log.date, log]));
  const totals = emptyPhaseMinutes();

  for (const date of dates) {
    let fastMin: number;
    if (date === today && status.phase !== "none") {
      // Today's fast is in progress — use the live elapsed time.
      fastMin = status.elapsedMin;
    } else {
      const log = byDate.get(date);
      const window = log ? eatingWindowForDay(log.meals) : null;
      fastMin = window ? Math.max(0, 24 * MIN_PER_HOUR - window.lengthMin) : 0;
    }
    const breakdown = phaseBreakdownMinutes(fastMin);
    for (const phase of FASTING_PHASES) {
      totals[phase.key] += breakdown[phase.key];
    }
  }
  return totals;
}
