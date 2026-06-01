import type { DailyLog, WeightEntry } from "@/lib/db";

/** Summary of the user's last 7 days. Each field is null/zero when
 *  there isn't enough data to populate it honestly — we'd rather
 *  show "—" than a misleading number computed from a single point. */
export type WeeklyRecap = {
  /** First day in the window (`YYYY-MM-DD`, today − 6). */
  windowStart: string;
  /** Last day in the window — today. */
  windowEnd: string;
  /** Count of days in the 7-day window where the user logged
   *  anything. Maxes at 7. */
  daysLogged: number;
  /** Daily averages, computed across the days WITH logs (not across
   *  all 7 days — averaging zeros for skipped days punishes you for
   *  not logging, which isn't what an "average daily intake"
   *  question is asking). All zero when no day was logged. */
  avg: { protein: number; carbs: number; fat: number; calories: number };
  /** Weight change in kg across the window (latest − earliest
   *  weigh-in). `null` when there are fewer than 2 weigh-ins in the
   *  window — one data point isn't a trend. */
  weightDeltaKg: number | null;
  /** Days where total calories landed within ±10% of the user's
   *  current calorie target. A rough adherence proxy — fine as a
   *  first-pass engagement signal, not a clinical KPI. */
  adherenceDays: number;
};

/** Generate a date list from `start` to `end` inclusive, both as
 *  `YYYY-MM-DD`. Local-date arithmetic to match the rest of the
 *  app's date handling. */
function datesInRange(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const stop = new Date(ey, em - 1, ed);
  const out: string[] = [];
  while (cur.getTime() <= stop.getTime()) {
    const yy = cur.getFullYear();
    const mm = (cur.getMonth() + 1).toString().padStart(2, "0");
    const dd = cur.getDate().toString().padStart(2, "0");
    out.push(`${yy}-${mm}-${dd}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function subtractDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - days);
  const yy = dt.getFullYear();
  const mm = (dt.getMonth() + 1).toString().padStart(2, "0");
  const dd = dt.getDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** ±10% of the calorie target counts as "on plan" for the
 *  adherence-days count. Strict enough that random days don't
 *  count, loose enough that real-world variation doesn't punish
 *  the user. */
const ADHERENCE_TOLERANCE = 0.1;

/** Compute the 7-day recap. Pure function — testable without IDB,
 *  time-travel-safe via the `today` parameter. The window is
 *  inclusive on both ends: `[today − 6, today]` = 7 days. */
export function computeWeeklyRecap(
  logs: DailyLog[],
  weights: WeightEntry[],
  targetCalories: number,
  today: string,
): WeeklyRecap {
  const windowStart = subtractDays(today, 6);
  const windowEnd = today;
  const window = new Set(datesInRange(windowStart, windowEnd));

  // Index logs by date inside the window. Empty meal arrays don't
  // count as "logged" — same definition the streak helper uses.
  let daysLogged = 0;
  let adherenceDays = 0;
  const totals = { protein: 0, carbs: 0, fat: 0, calories: 0 };
  for (const log of logs) {
    if (!window.has(log.date)) continue;
    const dayTotals = log.meals.reduce(
      (acc, m) => {
        for (const f of m.foods) {
          acc.protein += f.protein;
          acc.carbs += f.carbs;
          acc.fat += f.fat;
          acc.calories += f.calories;
        }
        return acc;
      },
      { protein: 0, carbs: 0, fat: 0, calories: 0 },
    );
    if (dayTotals.calories <= 0) continue;
    daysLogged += 1;
    totals.protein += dayTotals.protein;
    totals.carbs += dayTotals.carbs;
    totals.fat += dayTotals.fat;
    totals.calories += dayTotals.calories;
    if (targetCalories > 0) {
      const diff = Math.abs(dayTotals.calories - targetCalories);
      if (diff <= targetCalories * ADHERENCE_TOLERANCE) {
        adherenceDays += 1;
      }
    }
  }

  const avg =
    daysLogged > 0
      ? {
          protein: totals.protein / daysLogged,
          carbs: totals.carbs / daysLogged,
          fat: totals.fat / daysLogged,
          calories: totals.calories / daysLogged,
        }
      : { protein: 0, carbs: 0, fat: 0, calories: 0 };

  // Weight delta = latest − earliest within the window. Requires
  // ≥2 weigh-ins in the window for a meaningful number — one
  // point isn't a trend.
  const inWindow = weights.filter((w) => window.has(w.date));
  inWindow.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const weightDeltaKg =
    inWindow.length >= 2
      ? inWindow[inWindow.length - 1].kg - inWindow[0].kg
      : null;

  return {
    windowStart,
    windowEnd,
    daysLogged,
    avg,
    weightDeltaKg,
    adherenceDays,
  };
}
