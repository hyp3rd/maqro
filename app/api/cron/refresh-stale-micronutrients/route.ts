import { assertCronSecret } from "@/lib/auth/cron-secret";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Vercel cron handler — staleness sweep for micronutrient profiles.
 *
 *  Schedule (see `vercel.json`): once daily. The enrichment cron only ever
 *  enriches a name on log; nothing re-checks an APPROXIMATE profile later, even
 *  if the product has since appeared in Open Food Facts / CIQUAL. This sweep
 *  seeds old `search` / `ai` profiles back into the enrichment queue so the
 *  hourly drain re-resolves them — OFF/CIQUAL ONLY, never re-spending AI (the
 *  drain detects the refresh and skips the AI fallback) and never downgrading
 *  (the drain merges field-level).
 *
 *  Bounded + cooled-down: a fixed `LIMIT` per run, and `refreshed_at` is stamped
 *  on each swept profile so a name OFF keeps missing isn't re-swept for
 *  `COOLDOWN_DAYS` (the drain leaves the existing profile, the sweep won't pick
 *  it again until the cooldown lapses). EXCLUDES `barcode`/`ciqual` (already
 *  exact) and `miss` (deliberately suppressed — re-querying them defeats the
 *  miss-suppression). Pro is NOT re-checked here; the drain re-checks per row
 *  and drops non-Pro, so a non-Pro name simply enriches to nothing. */
const MAX_SWEEP = 200;
const COOLDOWN_DAYS = 30;

export async function GET(req: Request): Promise<NextResponse> {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  const adminConfig = getSupabaseSecretConfig();
  if (!adminConfig) {
    return NextResponse.json(
      { error: "Supabase service-role key not configured." },
      { status: 503 },
    );
  }
  const admin = createClient(adminConfig.url, adminConfig.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Second precision (drop the millisecond ".sssZ"): the cutoff is embedded in
  // a PostgREST `.or()` filter string, where the millis dot could be misparsed.
  // A 30-day cutoff doesn't need sub-second precision.
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  // Approximate profiles older than the cutoff and not swept within the
  // cooldown. (null refreshed_at = never swept → eligible.)
  const { data: stale, error: selErr } = await admin
    .from("micronutrient_profiles")
    .select("id, user_id, name_key")
    .in("source", ["search", "ai"])
    .lt("enriched_at", cutoff)
    .or(`refreshed_at.is.null,refreshed_at.lt.${cutoff}`)
    .order("enriched_at", { ascending: true })
    .limit(MAX_SWEEP);
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!stale || stale.length === 0) {
    return NextResponse.json({ swept: 0 });
  }

  // Seed the enrichment queue without disturbing live rows (a name already
  // queued keeps its place + attempts). No off_code — a refresh re-checks by
  // name; an exact product arrives only via a fresh log's upgrade enqueue.
  const { error: queueErr } = await admin.from("micronutrient_queue").upsert(
    stale.map((s) => ({
      user_id: s.user_id as string,
      name_key: s.name_key as string,
    })),
    { onConflict: "user_id,name_key", ignoreDuplicates: true },
  );
  if (queueErr) {
    return NextResponse.json({ error: queueErr.message }, { status: 500 });
  }

  // Stamp the cooldown on the swept profiles (last refresh ATTEMPT — so a row
  // that keeps missing isn't re-swept until the cooldown lapses, even if the
  // drain finds nothing).
  const { error: stampErr } = await admin
    .from("micronutrient_profiles")
    .update({ refreshed_at: new Date().toISOString() })
    .in(
      "id",
      stale.map((s) => s.id as string),
    );
  if (stampErr) {
    return NextResponse.json({ error: stampErr.message }, { status: 500 });
  }

  return NextResponse.json({ swept: stale.length });
}
