import { addDays } from "./date";
import type { DailyLog, Versioned } from "./records";
import type { Meal, PersonalInfo } from "./types";

/** Pure intermittent-fasting math — shared by the web app and the native app.
 *  No React, no IDB, no I/O: everything is derived from `FoodItem.loggedAt`
 *  timestamps + the profile's fasting config, so it stays trivially testable.
 *
 *  Time model: epoch milliseconds + the platform's local `Date`. A food's
 *  calendar day comes from `new Date(loggedAt)` local getters, so a 00:30 snack
 *  counts toward its own local day; "local" is the device's zone on every
 *  platform. (Server-zone helpers like the web app's `lib/local-time` are
 *  deliberately NOT used here — this is client-side device-zone math.) */

export type FastingConfig = NonNullable<PersonalInfo["fasting"]>;
export type FastingProtocol = FastingConfig["protocol"];

/** Selectable protocols, in display order (the custom option last). */
export const PROTOCOLS: readonly FastingProtocol[] = [
  "16:8",
  "18:6",
  "20:4",
  "custom",
];

const PROTOCOL_FAST_HOURS: Record<
  Exclude<FastingProtocol, "custom">,
  number
> = { "16:8": 16, "18:6": 18, "20:4": 20 };

const DEFAULT_FAST_HOURS = 16;
const MIN_FAST_HOURS = 12;
const MAX_FAST_HOURS = 23;
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

/** Grace added to the eating-window target before a day counts as
 *  off-protocol — a few minutes of slop shouldn't break a streak. */
export const DEFAULT_GRACE_MIN = 30;
/** Hour-of-day (local, 24h) at/after which calories count as "late". */
export const LATE_CUTOFF_HOUR = 20;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Humanize a minute count as `"3h 20m"` / `"45m"` / `"0m"`. Shared by the
 *  fast card, the Topbar chip, and the Progress summary so they read the
 *  same. */
export function formatDuration(totalMin: number): string {
  const mins = Math.max(0, Math.round(totalMin));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The fasting-hours target for a config (16:8 → 16). `custom` reads
 *  `customFastingHours`, clamped to a sane [12, 23] range. */
export function protocolHours(fasting: PersonalInfo["fasting"]): number {
  if (!fasting) return DEFAULT_FAST_HOURS;
  if (fasting.protocol === "custom") {
    return clamp(
      Math.round(fasting.customFastingHours ?? DEFAULT_FAST_HOURS),
      MIN_FAST_HOURS,
      MAX_FAST_HOURS,
    );
  }
  return PROTOCOL_FAST_HOURS[fasting.protocol] ?? DEFAULT_FAST_HOURS;
}

/** The eating-window length (hours) — the complement of the fast. */
export function eatingHours(fasting: PersonalInfo["fasting"]): number {
  return 24 - protocolHours(fasting);
}

export type EatingWindow = {
  /** First logged eat-time of the day (ms epoch). */
  firstAt: number;
  /** Last logged eat-time of the day (ms epoch). */
  lastAt: number;
  /** `lastAt - firstAt` in whole minutes (0 for a single timed food). */
  lengthMin: number;
};

/** The eating window for a single day's meals — the span between the first
 *  and last food that carries a `loggedAt`. Foods without one (AI plans,
 *  pre-feature logs) are ignored. `null` when no food is timed. */
export function eatingWindowForDay(meals: Meal[]): EatingWindow | null {
  let firstAt = Number.POSITIVE_INFINITY;
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const meal of meals) {
    for (const food of meal.foods) {
      if (typeof food.loggedAt !== "number") continue;
      if (food.loggedAt < firstAt) firstAt = food.loggedAt;
      if (food.loggedAt > lastAt) lastAt = food.loggedAt;
    }
  }
  if (firstAt === Number.POSITIVE_INFINITY) return null;
  return {
    firstAt,
    lastAt,
    lengthMin: Math.round((lastAt - firstAt) / MS_PER_MIN),
  };
}

export type FastPhase = "fasting" | "eating" | "none";

export type FastStatus = {
  /** `fasting` = counting down to the eating window; `eating` = the fast
   *  reached its target and the window is open; `none` = no fast running. */
  phase: FastPhase;
  /** When the (manually started) fast began, ms epoch; `null` when none. */
  fastStartedAt: number | null;
  /** When the eating window opens (ms epoch) = start + fasting hours. */
  fastEndsAt: number | null;
  /** Minutes until the window opens (`fasting`); 0 otherwise. */
  remainingMin: number;
  /** Minutes elapsed in the current phase (since fast start, or since the
   *  window opened). */
  elapsedMin: number;
  /** Fraction toward the fast target, 0–1 (1 once the window is open). */
  progress: number;
};

/** The live fast status from a **manually controlled** fast — the user taps
 *  "Start fast" (sets `fastStartedAt`), "Stop" (clears it), or edits the
 *  start time. Deliberately independent of food logging: adding, planning,
 *  or editing meals never moves the fast. `null` start → not fasting. */
export function computeFastStatus(opts: {
  fastStartedAt: number | null;
  fastingHours: number;
  now: number;
}): FastStatus {
  const { fastStartedAt, fastingHours, now } = opts;
  if (fastStartedAt === null) {
    return {
      phase: "none",
      fastStartedAt: null,
      fastEndsAt: null,
      remainingMin: 0,
      elapsedMin: 0,
      progress: 0,
    };
  }
  const start = fastStartedAt;
  const fastMs = fastingHours * MS_PER_HOUR;
  const fastEndsAt = start + fastMs;
  if (now < fastEndsAt) {
    return {
      phase: "fasting",
      fastStartedAt: start,
      fastEndsAt,
      remainingMin: Math.max(0, Math.round((fastEndsAt - now) / MS_PER_MIN)),
      elapsedMin: Math.max(0, Math.round((now - start) / MS_PER_MIN)),
      progress: clamp((now - start) / fastMs, 0, 1),
    };
  }
  return {
    phase: "eating",
    fastStartedAt: start,
    fastEndsAt,
    remainingMin: 0,
    elapsedMin: Math.max(0, Math.round((now - fastEndsAt) / MS_PER_MIN)),
    progress: 1,
  };
}

/** Minimum length (minutes) for a completed fast to be worth archiving to
 *  history. Filters accidental Start→Stop double-taps; anything real (even a
 *  short, broken fast) is kept, and the user can delete what they don't want. */
export const MIN_FAST_RECORD_MIN = 1;

/** The core facts of a completed fast — the raw inputs, before the store
 *  mints an id + sync metadata. Phase breakdown is NOT stored; it's derived on
 *  read via `phaseBreakdownMinutes(duration)`. */
export type FastSessionInput = {
  startedAt: number;
  endedAt: number;
  protocol: FastingProtocol;
  /** The fast-hours target in effect when the fast ran — captured so history
   *  stays accurate even if the user later switches protocol. */
  targetHours: number;
};

/** One completed intermittent fast, archived on Stop / auto-finalize. Unlike
 *  weigh-ins or BP this is **id-keyed**, not date-keyed: a fast can span
 *  midnight and a user can run more than one in a day, so `(user, day)` is the
 *  wrong grain. `startedAt` / `endedAt` are epoch-ms instants; `targetHours`
 *  pins the protocol target that was in effect. The per-phase split is derived
 *  on read (`phaseBreakdownMinutes`), never stored. */
export type FastSession = FastSessionInput & { id: string } & Versioned;

/** Build the record for a running fast that is ending at `endedAt`, or `null`
 *  when there's nothing to archive (no fast running, or a span below the
 *  record threshold — e.g. an accidental start→stop). Pure: the caller
 *  persists the result. Drives record-on-stop and the auto-finalize that fires
 *  when a still-running fast is replaced or tracking is turned off. */
export function buildFastSessionInput(
  fasting: PersonalInfo["fasting"],
  endedAt: number,
): FastSessionInput | null {
  if (!fasting || fasting.fastStartedAt == null) return null;
  const startedAt = fasting.fastStartedAt;
  const durationMin = Math.round((endedAt - startedAt) / MS_PER_MIN);
  if (durationMin < MIN_FAST_RECORD_MIN) return null;
  return {
    startedAt,
    endedAt,
    protocol: fasting.protocol,
    targetHours: protocolHours(fasting),
  };
}

/** Percentage of a day's timed calories logged at/after `cutoffHour` (local).
 *  Only foods with `loggedAt` count toward the denominator; 0 when none. */
export function lateCaloriePct(meals: Meal[], cutoffHour: number): number {
  let total = 0;
  let late = 0;
  for (const meal of meals) {
    for (const food of meal.foods) {
      if (typeof food.loggedAt !== "number") continue;
      total += food.calories;
      if (new Date(food.loggedAt).getHours() >= cutoffHour)
        late += food.calories;
    }
  }
  if (total <= 0) return 0;
  return Math.round((late / total) * 100);
}

export type FastingStreak = { current: number; longest: number };

/** Set of dates whose eating window fits the protocol (≤ eating hours +
 *  grace). Only days with a timed window are eligible. Shared by
 *  `fastingStreak` and `currentStreakDates`. */
function onProtocolDays(
  logs: DailyLog[],
  eatingHrs: number,
  graceMin: number,
): Set<string> {
  const targetMin = eatingHrs * 60 + graceMin;
  const set = new Set<string>();
  for (const log of logs) {
    const window = eatingWindowForDay(log.meals);
    if (window && window.lengthMin <= targetMin) set.add(log.date);
  }
  return set;
}

/** The dates (`YYYY-MM-DD`, oldest first) of the current on-protocol streak —
 *  the consecutive run anchored at today or yesterday. Empty when the streak
 *  is broken. Powers the per-streak phase breakdown on the Fasting page. */
export function currentStreakDates(
  logs: DailyLog[],
  today: string,
  eatingHrs: number,
  graceMin: number = DEFAULT_GRACE_MIN,
): string[] {
  const onProtocol = onProtocolDays(logs, eatingHrs, graceMin);
  let anchor: string | null = null;
  if (onProtocol.has(today)) anchor = today;
  else if (onProtocol.has(addDays(today, -1))) anchor = addDays(today, -1);
  if (!anchor) return [];
  const dates: string[] = [];
  let cursor: string | null = anchor;
  while (cursor !== null && onProtocol.has(cursor)) {
    dates.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return dates.reverse(); // oldest first
}

/** Consecutive days whose eating window fits the protocol (≤ eating hours +
 *  grace). Only days with a timed window are eligible; an off-protocol or
 *  un-timed day breaks the run. `current` is anchored to today-or-yesterday
 *  (same grace as `computeStreak`). Pure + time-travel-safe via `today`. */
export function fastingStreak(
  logs: DailyLog[],
  today: string,
  eatingHrs: number,
  graceMin: number = DEFAULT_GRACE_MIN,
): FastingStreak {
  const onProtocol = onProtocolDays(logs, eatingHrs, graceMin);
  if (onProtocol.size === 0) return { current: 0, longest: 0 };

  const sorted = [...onProtocol].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (addDays(sorted[i - 1], 1) === sorted[i]) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  return {
    current: currentStreakDates(logs, today, eatingHrs, graceMin).length,
    longest,
  };
}
