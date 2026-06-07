/** Pure validation for the `/api/suggest-day` model output. The model is handed
 *  the recipe ids + slot names and asked to return a subset, but it can
 *  hallucinate — so we keep only assignments whose slot AND recipe id are in the
 *  provided sets, dedupe slots (first wins), and drop malformed entries. Kept
 *  pure (no Anthropic, no request) so it unit-tests without the route. */
export type RawDayAssignment = { slot?: unknown; recipe_id?: unknown };

export function filterDayAssignments(
  raw: RawDayAssignment[] | undefined,
  validSlots: ReadonlySet<string>,
  validRecipeIds: ReadonlySet<string>,
): { slot: string; recipeId: string }[] {
  const seen = new Set<string>();
  const out: { slot: string; recipeId: string }[] = [];
  for (const a of raw ?? []) {
    if (!a || typeof a.slot !== "string" || typeof a.recipe_id !== "string") {
      continue;
    }
    if (!validSlots.has(a.slot) || !validRecipeIds.has(a.recipe_id)) continue;
    if (seen.has(a.slot)) continue;
    seen.add(a.slot);
    out.push({ slot: a.slot, recipeId: a.recipe_id });
  }
  return out;
}
