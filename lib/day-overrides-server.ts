import type { SupabaseClient } from "@supabase/supabase-js";

/** The outcome of a server read of the per-date session overrides. */
export type LoadedDayOverrides =
  | { ok: true; rows: { date: string; day: unknown }[] }
  | { ok: false; error: { message: string } };

/** Server twin of the app's override read (`useDayOverrides`): the user's
 *  `training_day_overrides` rows dated within `[from, to]` (local
 *  `YYYY-MM-DD` keys, inclusive), owner-scoped by `user_id` like the
 *  routes' other reads. Feed them to `dayOverrideResolver` so a cron
 *  resolves an overridden day exactly as the app shows it.
 *
 *  `day` is returned raw — `targetsForDate` validates it and ignores a
 *  malformed row. A read error is returned, not swallowed and not turned
 *  into "no overrides": the caller then skips the user, since a target
 *  computed without them could disagree with the app. */
export async function loadDayOverrides(
  admin: SupabaseClient,
  userId: string,
  range: { from: string; to: string },
): Promise<LoadedDayOverrides> {
  const { data, error } = await admin
    .from("training_day_overrides")
    .select("date, day")
    .eq("user_id", userId)
    .gte("date", range.from)
    .lte("date", range.to);
  if (error) return { ok: false, error: { message: error.message } };
  return {
    ok: true,
    rows: (data ?? []).map((row) => ({
      date: row.date as string,
      day: row.day as unknown,
    })),
  };
}
