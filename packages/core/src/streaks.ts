import { addDays } from "./date";
import type { DailyLog } from "./records";

/** Derived streak state for the user's daily-log history. The
 *  longest streak is the all-time best; the current streak is the
 *  one the user is actively riding (or just rode - see grace rule
 *  below). Both are zero when the user has never logged a meal. */
export type StreakState = {
  /** Length of the run ending at `today` or `yesterday`. Zero when
   *  the most-recent logged day is older than yesterday (the streak
   *  is broken and a new one starts at the next log). */
  current: number;
  /** Longest run of consecutive logged days in the user's history.
   *  Survives across breaks - once you hit 14, even a break to
   *  zero current still leaves longest at 14. */
  longest: number;
  /** Most recent date the user logged anything (`YYYY-MM-DD`), or
   *  `null` if they've never logged. Powers the "Last logged: 3
   *  days ago" line in the streak chip's tooltip. */
  lastLoggedDate: string | null;
};

/** A date counts as "logged" iff at least one meal contains at
 *  least one food. Empty meal arrays (the default-template seed
 *  rows users get on first load) don't count - otherwise every
 *  user would start with a streak just for opening the app. */
function isLogged(log: DailyLog): boolean {
  return log.meals.some((m) => m.foods.length > 0);
}

/** Compute the current + longest streak from a daily-log history.
 *
 *  Streak grace rule: the current streak is anchored to either
 *  `today` (if logged today) or `yesterday` (if logged yesterday).
 *  Beyond yesterday → the streak is considered broken. This is the
 *  conventional pattern: it gives the user until end-of-day to log
 *  without spiking anxiety, and the streak breaks the day after
 *  they actually skip.
 *
 *  Pure function - testable without IDB, time-travel-safe via the
 *  `today` parameter. */
export function computeStreak(logs: DailyLog[], today: string): StreakState {
  if (logs.length === 0) {
    return { current: 0, longest: 0, lastLoggedDate: null };
  }
  // Build the set of dates that actually have logged foods. A user
  // with empty meal templates spanning many days shouldn't get a
  // streak for them.
  const loggedDates = new Set<string>();
  for (const log of logs) {
    if (isLogged(log)) loggedDates.add(log.date);
  }
  if (loggedDates.size === 0) {
    return { current: 0, longest: 0, lastLoggedDate: null };
  }

  // Sort the logged dates ascending. We walk forward to find the
  // longest historical run, and the anchor for `current` is found
  // by walking backward from today.
  const sortedDates = [...loggedDates].sort();

  // Longest run: classic scan, reset on gap.
  let longest = 1;
  let runLen = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = sortedDates[i - 1];
    const cur = sortedDates[i];
    if (addDays(prev, 1) === cur) {
      runLen += 1;
      if (runLen > longest) longest = runLen;
    } else {
      runLen = 1;
    }
  }

  // Anchor for current: today if logged today, else yesterday if
  // logged yesterday, else 0 (streak broken).
  let anchor: string | null = null;
  if (loggedDates.has(today)) anchor = today;
  else if (loggedDates.has(addDays(today, -1))) anchor = addDays(today, -1);

  let current = 0;
  if (anchor) {
    current = 1;
    let cursor = addDays(anchor, -1);
    // Walk backward as long as each previous day is also logged.
    while (loggedDates.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  return {
    current,
    longest,
    lastLoggedDate: sortedDates[sortedDates.length - 1] ?? null,
  };
}

/** Milestone thresholds the streak passes through.
 *
 *  Spacing matches the engagement literature: the early ones (3,
 *  7, 14) reinforce a new habit while it's still fragile; the
 *  longer ones (30, 60, 100, 180, 365) celebrate genuine
 *  durability. Keeping them sparse past 30 avoids "trophy
 *  fatigue" — a celebration every other day stops feeling
 *  special. Ordered ascending; callers rely on that order. */
export const STREAK_MILESTONES: readonly number[] = [
  3, 7, 14, 30, 60, 100, 180, 365,
] as const;

/** Returns the next milestone strictly greater than `current`, or
 *  `null` if the user has already crossed the final tier. Used to
 *  power the "X days until your next milestone" tooltip. */
export function nextMilestone(current: number): number | null {
  for (const m of STREAK_MILESTONES) {
    if (m > current) return m;
  }
  return null;
}

/** The single highest milestone the streak has reached so far.
 *  `null` when below the first threshold. Used by the celebration
 *  gate: we celebrate the FIRST time this returns a value greater
 *  than the last-celebrated stored in localStorage. */
export function reachedMilestone(current: number): number | null {
  let reached: number | null = null;
  for (const m of STREAK_MILESTONES) {
    if (current >= m) reached = m;
    else break;
  }
  return reached;
}
