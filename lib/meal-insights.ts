import {
  MICRONUTRIENTS,
  type MicronutrientKey,
  type MicronutrientValues,
} from "@/lib/rda";

/** Tone of an insight — drives icon + colour. `warn` = worth fixing,
 *  `good` = a positive worth reinforcing, `info` = neutral nudge. */
export type MealInsightTone = "good" | "warn" | "info";

export type MealInsight = {
  tone: MealInsightTone;
  /** Short headline, e.g. "Low fiber". */
  title: string;
  /** One-line specifics, e.g. "Only 2g — a meal this size ideally…". */
  detail: string;
};

export type MealInsightInput = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Sub-macros (per-meal totals, "where available"). */
  addedSugars?: number;
  fiber?: number;
  saturatedFat?: number;
  /** Aggregated micronutrient totals for the meal (Pro). */
  micros?: MicronutrientValues;
  /** Per-nutrient *daily* targets (Pro). */
  microTargets?: Partial<Record<MicronutrientKey, number>>;
  /** The user's *daily* macro goal — enables "how does this meal serve
   *  your goal" reads (calorie share, protein adequacy vs target). */
  goal?: { calories: number; protein: number; carbs: number; fat: number };
};

// Thresholds are deliberately conservative — a flag should mean
// something. Per-meal numbers are framed against typical daily ceilings
// (sat fat ~20g, added sugar ~50g) and a balanced ~3-meal day.
const FIBER_LOW_FLOOR_G = 3; // a sizeable meal under this reads as low-fiber
const FIBER_GOOD_G = 7;
const SAT_FAT_WARN_G = 7;
const ADDED_SUGAR_WARN_G = 12;
const SIZEABLE_MEAL_KCAL = 300;
const MICRO_GOOD_PCT = 30; // a meal providing ≥30% of a daily target
const SODIUM_WARN_PCT = 40;
const BIG_MEAL_CAL_SHARE = 0.45; // one meal ≥ this share of the day = "big"
const PROTEIN_LIGHT_RATIO = 0.6; // protein density < 60% of the goal's
const PROTEIN_STRONG_RATIO = 1.3; // protein density ≥ 130% of the goal's

const TONE_ORDER: Record<MealInsightTone, number> = {
  warn: 0,
  info: 1,
  good: 2,
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Deterministic, offline analysis of a single meal. Surfaces macro
 *  imbalances + sub-macro / micronutrient flags ("low fiber", "high
 *  saturated fat", "great source of vitamin C"). Returns an empty list
 *  when nothing crosses a threshold — a calm, balanced meal earns no
 *  noise. Warnings sort first. */
export function computeMealInsights(input: MealInsightInput): MealInsight[] {
  const out: MealInsight[] = [];
  const { calories, protein, carbs, fat } = input;

  // --- Macro balance (always available) ---
  const pk = protein * 4;
  const ck = carbs * 4;
  const fk = fat * 9;
  const total = Math.max(1, pk + ck + fk);
  const fatShare = fk / total;
  const carbShare = ck / total;
  const proteinShare = pk / total;
  if (fatShare > 0.5) {
    out.push({
      tone: "warn",
      title: "Fat-heavy",
      detail: `${Math.round(fatShare * 100)}% of this meal's calories come from fat.`,
    });
  } else if (proteinShare >= 0.35) {
    out.push({
      tone: "good",
      title: "Protein-forward",
      detail: `${Math.round(proteinShare * 100)}% of calories from protein.`,
    });
  }
  if (carbShare > 0.65) {
    out.push({
      tone: "info",
      title: "Carb-heavy",
      detail: `${Math.round(carbShare * 100)}% of calories from carbs — pair with protein + fiber.`,
    });
  }

  // --- Saturated fat ---
  if (
    typeof input.saturatedFat === "number" &&
    input.saturatedFat >= SAT_FAT_WARN_G
  ) {
    out.push({
      tone: "warn",
      title: "High saturated fat",
      detail: `${round1(input.saturatedFat)}g — most guidance caps the day near 20g.`,
    });
  }

  // --- Added sugar ---
  if (
    typeof input.addedSugars === "number" &&
    input.addedSugars >= ADDED_SUGAR_WARN_G
  ) {
    out.push({
      tone: "warn",
      title: "High added sugar",
      detail: `${round1(input.addedSugars)}g added — the daily cap is ~50g.`,
    });
  }

  // --- Fiber ---
  if (typeof input.fiber === "number") {
    if (input.fiber >= FIBER_GOOD_G) {
      out.push({
        tone: "good",
        title: "Good fiber",
        detail: `${round1(input.fiber)}g in this meal.`,
      });
    } else if (
      calories >= SIZEABLE_MEAL_KCAL &&
      input.fiber < FIBER_LOW_FLOOR_G
    ) {
      out.push({
        tone: "warn",
        title: "Low fiber",
        detail: `Only ${round1(input.fiber)}g — a meal this size ideally has 6–8g. Add veg, fruit, beans, or whole grains.`,
      });
    }
  }

  // --- Goal fit (when daily macro targets are supplied) ---
  if (input.goal && input.goal.calories > 0) {
    const g = input.goal;
    const calShare = calories / g.calories;
    if (calShare > BIG_MEAL_CAL_SHARE) {
      out.push({
        tone: "info",
        title: "Big share of your day",
        detail: `${Math.round(calShare * 100)}% of your ${Math.round(g.calories)} kcal goal in one meal.`,
      });
    }
    if (g.protein > 0 && calories >= 200) {
      // Protein per calorie, meal vs the goal's required density.
      const ratio = protein / Math.max(1, calories) / (g.protein / g.calories);
      if (ratio <= PROTEIN_LIGHT_RATIO) {
        out.push({
          tone: "warn",
          title: "Light on protein for your goal",
          detail:
            "Its calories outpace its protein versus your daily target — add a lean protein.",
        });
      } else if (ratio >= PROTEIN_STRONG_RATIO && proteinShare < 0.35) {
        out.push({
          tone: "good",
          title: "Serves your protein goal",
          detail: "Protein-dense relative to your daily target.",
        });
      }
    }
  }

  // --- Micronutrient highlights (Pro: micros + targets supplied) ---
  if (input.micros && input.microTargets) {
    const goods: { key: MicronutrientKey; pct: number }[] = [];
    for (const key of Object.keys(input.micros) as MicronutrientKey[]) {
      const v = input.micros[key];
      const target = input.microTargets[key];
      if (typeof v !== "number" || !target) continue;
      const pct = (v / target) * 100;
      if (key === "sodium") {
        // Sodium is a ceiling, not a goal — high is the flag.
        if (pct >= SODIUM_WARN_PCT) {
          out.push({
            tone: "warn",
            title: "High sodium",
            detail: `${Math.round(pct)}% of your daily sodium in one meal.`,
          });
        }
        continue;
      }
      if (pct >= MICRO_GOOD_PCT) goods.push({ key, pct });
    }
    goods
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3)
      .forEach((g) => {
        const label = MICRONUTRIENTS[g.key].label;
        out.push({
          tone: "good",
          title: `Great source of ${label}`,
          detail: `${Math.round(g.pct)}% of your daily ${label.toLowerCase()}.`,
        });
      });
  }

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
