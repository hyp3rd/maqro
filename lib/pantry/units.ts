/** Curated unit options for pantry items. Free-text units made the
 *  same thing get typed as "g" / "gr" / "grams", which the mass
 *  reconciliation in `consume.ts` can't always match — a short list
 *  steers users toward values that reconcile. The mass entries here
 *  (`g`, `kg`, `mg`, `oz`, `lb`) are exactly the keys recognized by
 *  `GRAMS_PER_UNIT` in [consume.ts](./consume.ts), so a recipe's grams
 *  can be subtracted from them. Volume + container units are offered for
 *  convenience but fall through to whole-unit decrement (grams ↔ ml
 *  needs a density we don't have).
 *
 *  The editor still allows a custom typed value, so this list is
 *  guidance, not a hard constraint — legacy free-text units survive. */
export type PantryUnitPreset = { value: string; label: string };

export const PANTRY_UNIT_PRESETS: PantryUnitPreset[] = [
  { value: "unit", label: "unit" },
  { value: "g", label: "grams (g)" },
  { value: "kg", label: "kilograms (kg)" },
  { value: "mg", label: "milligrams (mg)" },
  { value: "ml", label: "milliliters (ml)" },
  { value: "l", label: "litres (l)" },
  { value: "oz", label: "ounces (oz)" },
  { value: "lb", label: "pounds (lb)" },
  { value: "can", label: "can" },
  { value: "pack", label: "pack" },
  { value: "bag", label: "bag" },
  { value: "bottle", label: "bottle" },
  { value: "jar", label: "jar" },
  { value: "scoop", label: "scoop" },
  { value: "tbsp", label: "tablespoon (tbsp)" },
  { value: "tsp", label: "teaspoon (tsp)" },
  { value: "cup", label: "cup" },
];

/** True when `unit` is one of the curated presets (case-insensitive on
 *  the trimmed value). Used by the editor to decide whether to preselect
 *  the dropdown or drop into the custom-text fallback. */
export function isPresetUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase();
  return PANTRY_UNIT_PRESETS.some((p) => p.value === u);
}
