import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { FEATURES } from "@/lib/billing/tiers";
import { loadUserTier } from "@/lib/billing/usage";
import { reportServerError } from "@/lib/error-reporter";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Enqueue food names for background micronutrient enrichment.
 *
 *  Called fire-and-forget by the client when a Pro user saves a daily
 *  log (the existing `saveDailyLog` choke point). The body carries the
 *  distinct normalized food names eaten that day; we filter to the ones
 *  that don't already have a profile and upsert them into
 *  `micronutrient_queue`. The hourly cron drains the queue.
 *
 *  Gating: Pro only, re-checked server-side here (the client gate is
 *  UX). A non-Pro caller gets a silent 200 with `enqueued: 0` rather
 *  than a 402 — this is a background nicety, not a user action, so
 *  there's nothing to surface.
 *
 *  Each name optionally carries an `offCode` (the OFF barcode, when the
 *  logged food came from an OFF source) so the cron can do an exact
 *  product lookup. */
const BodySchema = z.object({
  items: z
    .array(
      z.object({
        // Already-normalized on the client (lowercased + trimmed); we
        // re-normalize defensively below so a bad client can't seed a
        // mixed-case duplicate.
        nameKey: z.string().min(1).max(200),
        offCode: z.string().max(32).optional(),
      }),
    )
    .max(100),
});

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // AAL2 gate. For a non-MFA user this is a no-op (assertAal2 resolves
  // ok); for an MFA-enrolled user it ensures the session is promoted,
  // honouring the trust-this-device escape hatch. Consistent with every
  // other authenticated route per the require-aal2-gate lint rule.
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  // Pro gate — re-checked server-side. Non-Pro is a no-op, not an
  // error: enrichment is a background feature, nothing to surface.
  const tier = await loadUserTier(supabase, user.id);
  if (!FEATURES.canTrackMicronutrients(tier)) {
    return NextResponse.json({ enqueued: 0 });
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  // Dedupe + re-normalize the incoming names.
  const byKey = new Map<string, { nameKey: string; offCode?: string }>();
  for (const item of parsed.data.items) {
    const nameKey = item.nameKey.toLowerCase().trim();
    if (!nameKey) continue;
    // First-seen wins for the offCode — a barcode-sourced occurrence is
    // strictly more useful to the cron than a bare name, so prefer it.
    const existing = byKey.get(nameKey);
    if (!existing) {
      byKey.set(nameKey, { nameKey, offCode: item.offCode });
    } else if (!existing.offCode && item.offCode) {
      existing.offCode = item.offCode;
    }
  }
  if (byKey.size === 0) return NextResponse.json({ enqueued: 0 });

  const names = [...byKey.keys()];
  try {
    // Skip names that already have a profile — no point re-enriching.
    const { data: existing } = await supabase
      .from("micronutrient_profiles")
      .select("name_key")
      .eq("user_id", user.id)
      .in("name_key", names);
    const enriched = new Set((existing ?? []).map((r) => r.name_key as string));

    const rows = [...byKey.values()]
      .filter((v) => !enriched.has(v.nameKey))
      .map((v) => ({
        user_id: user.id,
        name_key: v.nameKey,
        off_code: v.offCode ?? null,
      }));
    if (rows.length === 0) return NextResponse.json({ enqueued: 0 });

    // On-conflict-do-nothing: a name already queued stays as-is (don't
    // reset its attempts counter). `ignoreDuplicates` maps to ON
    // CONFLICT DO NOTHING against the (user_id, name_key) unique index.
    const { error } = await supabase
      .from("micronutrient_queue")
      .upsert(rows, { onConflict: "user_id,name_key", ignoreDuplicates: true });
    if (error) throw error;

    return NextResponse.json({ enqueued: rows.length });
  } catch (err) {
    // Best-effort: enrichment enqueue failing must never disrupt the
    // log-save flow that triggered it. Log and report success-shaped
    // so the fire-and-forget caller doesn't retry-storm.
    void reportServerError(err, {
      route: "/api/micronutrient-enqueue",
      userId: user.id,
    });
    return NextResponse.json({ enqueued: 0 });
  }
}
