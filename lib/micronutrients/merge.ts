import type { MicronutrientValues } from "@/lib/rda";
import type { MacroBreakdown } from "@maqro/core/types";
import type { MicronutrientProfile } from "./types";

/** Source quality rank, highest = most trustworthy. A single barcode-matched
 *  product beats a curated lab reference beats a name-search median beats an AI
 *  guess beats a recorded miss. Used to pick a winner when profiles collide and
 *  to forbid downgrades on a refresh. */
const SOURCE_RANK: Record<MicronutrientProfile["source"], number> = {
  barcode: 4,
  ciqual: 3,
  search: 2,
  ai: 1,
  miss: 0,
};

export function sourceRank(source: MicronutrientProfile["source"]): number {
  return SOURCE_RANK[source];
}

/** When the Unicode (NFC) re-key collapses two previously-distinct keys onto
 *  one (the same food typed in different encoding forms), keep ONE profile:
 *  highest source rank, then most recently enriched. Pure + deterministic so the
 *  IDB re-key and the SQL migration converge on the same survivor.
 *
 *  `profiles` must be non-empty (callers group by key, so each group has ≥1). */
export function pickWinnerProfile(
  profiles: readonly MicronutrientProfile[],
): MicronutrientProfile {
  return profiles.reduce((best, p) => {
    const byRank = sourceRank(p.source) - sourceRank(best.source);
    if (byRank > 0) return p;
    if (byRank < 0) return best;
    return p.enrichedAt > best.enrichedAt ? p : best;
  });
}

/** The resolvable fields of a profile, in the cron's terms. */
export type MergeableProfile = {
  source: MicronutrientProfile["source"];
  values: MicronutrientValues;
  sourceCode: string | null;
  breakdown: MacroBreakdown | null;
};

/** Combine a freshly-resolved result with the EXISTING stored profile so a
 *  re-enrich / staleness refresh can only IMPROVE it — never downgrade. The
 *  guarantees:
 *    - source + values move together and stay from ONE source (so #1's
 *      offCode-gated "approx" markers never mislabel a grafted value as exact);
 *    - take the resolved micros only when it has values AND is same-or-higher
 *      rank — an empty-value result (e.g. a barcode product that lists a label
 *      but no micros) never wipes existing micro coverage;
 *    - a non-null breakdown is never replaced with null (the label backfill
 *      survives even when a higher-rank source carries no breakdown);
 *    - source_code is never blanked.
 *  Returns `null` when nothing would change, so the caller can skip a no-op
 *  write (and a worse/empty resolve simply leaves the existing profile). */
export function mergeMicronutrientProfile(
  existing: MergeableProfile,
  resolved: MergeableProfile,
): MergeableProfile | null {
  const breakdown = resolved.breakdown ?? existing.breakdown;
  const resolvedHasValues = Object.keys(resolved.values).length > 0;
  const takeResolved =
    resolvedHasValues &&
    sourceRank(resolved.source) >= sourceRank(existing.source);

  if (takeResolved) {
    return {
      source: resolved.source,
      values: resolved.values,
      sourceCode: resolved.sourceCode ?? existing.sourceCode,
      breakdown,
    };
  }
  // The resolved result didn't improve the micros — only a backfilled breakdown
  // could change anything. Keep the existing source + values.
  if (breakdown === existing.breakdown) return null;
  return { ...existing, breakdown };
}
