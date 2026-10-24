import { bodyFatBodyType, latestBodyFatPct } from "@maqro/core/body-fat";
import type { PersonalInfo } from "@maqro/core/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The outcome of a server read of the body-fat % the targets use. */
export type LoadedBodyFat =
  | { ok: true; bodyFatPct: number | null }
  | { ok: false; error: { message: string } };

/** Server twin of the app's body-fat read: the user's latest
 *  `body_measurements` reading that has the formula's inputs, through the
 *  same `latestBodyFatPct` the app and /report use, so the crons resolve a
 *  training-day target exactly as the app shows it.
 *
 *  The query mirrors `hasBodyFatInputs` (waist + neck, plus hips for the
 *  female formula; the schema's CHECK keeps stored values positive) and
 *  takes the newest such row, which is the row `latestBodyFatPct` would pick
 *  out of the whole history. A gender with no published formula makes no
 *  query. Owner-scoped by `user_id`, like the routes' other reads.
 *
 *  A read error is returned, not swallowed and not turned into "no
 *  estimate": the caller then skips the user, since a target computed
 *  without the estimate could disagree with the app. */
export async function loadLatestBodyFatPct(
  admin: SupabaseClient,
  userId: string,
  profile: Pick<PersonalInfo, "gender" | "height">,
): Promise<LoadedBodyFat> {
  const bodyType = bodyFatBodyType(profile.gender);
  if (!bodyType) return { ok: true, bodyFatPct: null };

  // Every column the body type's formula needs (`hasBodyFatInputs`).
  const required =
    bodyType === "female"
      ? ["waist_cm", "neck_cm", "hips_cm"]
      : ["waist_cm", "neck_cm"];
  let query = admin
    .from("body_measurements")
    .select("date, waist_cm, neck_cm, hips_cm")
    .eq("user_id", userId);
  for (const column of required) query = query.not(column, "is", null);
  const { data, error } = await query
    .order("date", { ascending: false })
    .limit(1);
  if (error) return { ok: false, error: { message: error.message } };

  const rows = (data ?? []).map((row) => ({
    date: row.date as string,
    waistCm: row.waist_cm as number | null,
    neckCm: row.neck_cm as number | null,
    hipsCm: row.hips_cm as number | null,
  }));
  return {
    ok: true,
    bodyFatPct: latestBodyFatPct(rows, {
      gender: profile.gender,
      heightCm: profile.height,
    }),
  };
}
