/** Micronutrient reference table — the single source of truth for the
 *  ~10 micronutrients this app tracks.
 *
 *  Reference values are the **FDA Daily Values (DV)** for adults and
 *  children ≥ 4 years, as published in the Nutrition Facts label
 *  regulation (21 CFR 101.9, 2016 update). A flat single value per
 *  nutrient is a deliberate v1 simplification — it matches how every
 *  packaged-food label in the US reports "% Daily Value", which is the
 *  mental model users already have. The structure leaves room to swap
 *  in age/gender-aware DRI values later (key the lookup off
 *  `PersonalInfo.gender` / `age`) without changing any caller.
 *
 *  Canonical units are chosen so the stored value never needs
 *  conversion at read time: Open Food Facts reports its `_100g`
 *  nutriment fields in base SI grams, and the converter in
 *  [off-search.ts](./ai/off-search.ts) normalizes once on write to
 *  the unit below. fiber stays in grams (the label unit); minerals in
 *  mg; the two trace vitamins (D, B12) in µg.
 *
 *  `cssVar` references a CSS custom property defined in
 *  [app/globals.css](../app/globals.css) so the progress bars + charts
 *  colour-code consistently with the macro palette. */

export type MicronutrientKey =
  | "fiber"
  | "sodium"
  | "potassium"
  | "calcium"
  | "iron"
  | "magnesium"
  | "zinc"
  | "vitaminC"
  | "vitaminD"
  | "vitaminB12";

/** A partial map of nutrient → value. Used both for per-100g profile
 *  values and for summed totals. Lives here (a leaf module with no
 *  imports from `lib/db` or the component types) so the food types in
 *  `components/macro/types.ts` can reference it without an import
 *  cycle — `lib/db` imports those food types, so the food types must
 *  not transitively import `lib/db`. */
export type MicronutrientValues = Partial<Record<MicronutrientKey, number>>;

/** Canonical storage / display unit for each nutrient. */
export type MicronutrientUnit = "g" | "mg" | "µg";

export type MicronutrientMeta = {
  /** Human label for the progress row + report. */
  label: string;
  /** Canonical unit the stored per-100g value is expressed in. */
  unit: MicronutrientUnit;
  /** FDA Daily Value in the canonical unit — the target for the
   *  progress bar and the chart reference line. */
  dv: number;
  /** CSS custom property for the bar / line colour. */
  cssVar: string;
  /** Multiplier applied to Open Food Facts' base-SI gram value to
   *  reach the canonical unit: 1 (g→g), 1000 (g→mg), 1e6 (g→µg). */
  offGramsToCanonical: number;
};

/** The reference table. Ordering here is the display order in the UI
 *  and report (fiber first as the most-tracked, then electrolytes,
 *  then minerals, then vitamins). */
export const MICRONUTRIENTS: Record<MicronutrientKey, MicronutrientMeta> = {
  fiber: {
    label: "Fiber",
    unit: "g",
    dv: 28,
    cssVar: "--micro-fiber",
    offGramsToCanonical: 1,
  },
  sodium: {
    label: "Sodium",
    unit: "mg",
    dv: 2300,
    cssVar: "--micro-sodium",
    offGramsToCanonical: 1000,
  },
  potassium: {
    label: "Potassium",
    unit: "mg",
    dv: 4700,
    cssVar: "--micro-potassium",
    offGramsToCanonical: 1000,
  },
  calcium: {
    label: "Calcium",
    unit: "mg",
    dv: 1300,
    cssVar: "--micro-calcium",
    offGramsToCanonical: 1000,
  },
  iron: {
    label: "Iron",
    unit: "mg",
    dv: 18,
    cssVar: "--micro-iron",
    offGramsToCanonical: 1000,
  },
  magnesium: {
    label: "Magnesium",
    unit: "mg",
    dv: 420,
    cssVar: "--micro-magnesium",
    offGramsToCanonical: 1000,
  },
  zinc: {
    label: "Zinc",
    unit: "mg",
    dv: 11,
    cssVar: "--micro-zinc",
    offGramsToCanonical: 1000,
  },
  vitaminC: {
    label: "Vitamin C",
    unit: "mg",
    dv: 90,
    cssVar: "--micro-vitamin-c",
    offGramsToCanonical: 1000,
  },
  vitaminD: {
    label: "Vitamin D",
    unit: "µg",
    dv: 20,
    cssVar: "--micro-vitamin-d",
    offGramsToCanonical: 1_000_000,
  },
  vitaminB12: {
    label: "Vitamin B12",
    unit: "µg",
    dv: 2.4,
    cssVar: "--micro-vitamin-b12",
    offGramsToCanonical: 1_000_000,
  },
};

/** Stable display / iteration order — `Object.keys` order is reliable
 *  for string keys, but exporting it explicitly makes the intent clear
 *  and decouples callers from the literal declaration order. */
export const MICRONUTRIENT_KEYS = Object.keys(
  MICRONUTRIENTS,
) as MicronutrientKey[];

// ─── Age/sex-specific targets (NIH Dietary Reference Intakes) ──────────────

/** Biological sex for DRI lookup. `unspecified` (non-binary /
 *  prefer-not-to-say, or a missing profile) falls back to the flat FDA
 *  Daily Values above — there's no published single-value DRI for an
 *  unspecified sex, and inventing one would be worse than the
 *  label-standard DV most users already recognize. */
export type BiologicalSex = "male" | "female" | "unspecified";

/** NIH RDA/AI values for adults (19+), in each nutrient's canonical
 *  unit. These are the recommended *intakes*, which differ from the
 *  FDA label DV (a single value chosen for labelling) — notably iron
 *  (18 mg for menstruating women vs 8 mg for men) and the
 *  electrolytes. Sodium is the Chronic Disease Risk Reduction limit
 *  (an upper bound, same for both sexes). Where a value matches the
 *  DV we still list it so the table is self-contained.
 *
 *  Source: NIH Office of Dietary Supplements fact sheets + the
 *  2020–2025 Dietary Guidelines. Two age bands cover the bulk of
 *  adults; the `older` overlay below applies the well-established 51+
 *  / 71+ adjustments (calcium up, post-menopausal iron down, vitamin D
 *  up). Refine with finer bands or pregnancy/lactation only if real
 *  demand appears — flagged as a follow-up. */
const DRI_ADULT: Record<"male" | "female", Record<MicronutrientKey, number>> = {
  male: {
    fiber: 38,
    sodium: 2300,
    potassium: 3400,
    calcium: 1000,
    iron: 8,
    magnesium: 420,
    zinc: 11,
    vitaminC: 90,
    vitaminD: 15,
    vitaminB12: 2.4,
  },
  female: {
    fiber: 25,
    sodium: 2300,
    potassium: 2600,
    calcium: 1000,
    iron: 18,
    magnesium: 320,
    zinc: 8,
    vitaminC: 75,
    vitaminD: 15,
    vitaminB12: 2.4,
  },
};

/** Resolve per-nutrient daily targets for a user. Returns the flat FDA
 *  Daily Values when sex is `unspecified`; otherwise the adult NIH RDA
 *  with the standard older-adult overlay:
 *    - 51+ women: iron drops to 8 mg (post-menopause), calcium up to
 *      1200 mg, fiber down to 21 g.
 *    - 51+ men: fiber down to 30 g; calcium up to 1200 mg at 71+.
 *    - 71+ either sex: vitamin D up to 20 µg.
 *  Age ≤ 0 / non-finite is treated as an adult (the overlay just
 *  doesn't apply). */
export function getMicronutrientTargets(
  sex: BiologicalSex,
  age: number,
): Record<MicronutrientKey, number> {
  if (sex === "unspecified") {
    return MICRONUTRIENT_KEYS.reduce(
      (acc, k) => {
        acc[k] = MICRONUTRIENTS[k].dv;
        return acc;
      },
      {} as Record<MicronutrientKey, number>,
    );
  }
  const targets = { ...DRI_ADULT[sex] };
  const a = Number.isFinite(age) ? age : 30;
  if (a >= 51) {
    if (sex === "female") {
      targets.iron = 8;
      targets.calcium = 1200;
      targets.fiber = 21;
    } else {
      targets.fiber = 30;
      if (a >= 71) targets.calcium = 1200;
    }
    if (a >= 71) targets.vitaminD = 20;
  }
  return targets;
}
