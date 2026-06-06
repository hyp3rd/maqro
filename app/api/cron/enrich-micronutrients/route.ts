import { getAnthropicConfig } from "@/lib/ai/env";
import {
  fetchOffProductResult,
  medianMicronutrients,
  offHitToMicronutrients,
  searchOffHitsServer,
} from "@/lib/ai/off-search";
import { assertCronSecret } from "@/lib/auth/cron-secret";
import { FEATURES } from "@/lib/billing/tiers";
import { loadUserTier } from "@/lib/billing/usage";
import { ciqualMicronutrients } from "@/lib/ciqual-micros";
import { estimateMicronutrientsAI } from "@/lib/micronutrients/ai-estimate";
import type { MicronutrientValues } from "@/lib/micronutrients/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Vercel cron handler — drain the micronutrient enrichment queue.
 *
 *  Schedule (see `vercel.json`): hourly. Each run pulls a bounded batch
 *  of the oldest pending queue rows, resolves each food on Open Food
 *  Facts, writes a `micronutrient_profiles` row, and deletes the queue
 *  row. A miss (no OFF match) still writes an empty `source = 'miss'`
 *  profile so the name is never re-queried.
 *
 *  Why a bounded batch + hourly rather than draining everything: Open
 *  Food Facts asks API consumers to keep request rates polite. We cap
 *  the batch and rate-limit between upstream calls so a backlog drains
 *  gradually instead of hammering OFF in a burst.
 *
 *  Pro re-check per row: a user might have downgraded between enqueue
 *  and drain. We re-verify the owner is still Pro and skip+delete the
 *  row if not, so a lapsed subscription stops consuming enrichment. */
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
/** Cap AI-estimate calls per cron run. The AI fallback only fires when
 *  Open Food Facts has no match, and each call costs real API spend, so
 *  we bound it per run. Names that miss OFF beyond this cap are left in
 *  the queue and picked up on the next run's AI budget — they aren't
 *  written off as misses. */
const MAX_AI_ESTIMATES_PER_RUN = 10;

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

  const { data: rows, error: queueErr } = await admin
    .from("micronutrient_queue")
    .select("id, user_id, name_key, off_code, attempts")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (queueErr) {
    return NextResponse.json({ error: queueErr.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({
      processed: 0,
      enriched: 0,
      missed: 0,
      skipped: 0,
    });
  }

  // Cache tier decisions within a batch — many rows often share a user.
  const tierCache = new Map<string, boolean>();
  const aiKey = getAnthropicConfig()?.apiKey ?? null;
  let aiCallsUsed = 0;
  let enriched = 0;
  let estimated = 0;
  let missed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const userId = row.user_id as string;
    const nameKey = row.name_key as string;
    const offCode = (row.off_code as string | null) ?? undefined;
    const attempts = (row.attempts as number) ?? 0;

    // Pro re-check (cached per user per batch).
    let isPro = tierCache.get(userId);
    if (isPro === undefined) {
      const tier = await loadUserTier(admin as SupabaseClient, userId);
      isPro = FEATURES.canTrackMicronutrients(tier);
      tierCache.set(userId, isPro);
    }
    if (!isPro) {
      await deleteQueueRow(admin, row.id as string);
      skipped++;
      continue;
    }

    // Politeness gate for OFF. A global bucket caps how fast the cron
    // hits upstream across all users. If throttled, leave the row for
    // the next run (don't bump attempts — it wasn't the food's fault).
    const gate = await checkRateLimit({
      bucket: "off:enrich",
      limit: 100,
      windowSeconds: 60,
    });
    if (!gate.allowed) {
      skipped++;
      continue;
    }

    try {
      // AI is permitted this iteration only when configured AND under
      // the per-run cap. When OFF misses and AI is NOT permitted, the
      // resolver returns "defer" so we leave the row for next run
      // rather than recording a premature miss.
      const aiPermitted =
        aiKey !== null && aiCallsUsed < MAX_AI_ESTIMATES_PER_RUN;
      const result = await resolveMicronutrients(nameKey, offCode, {
        aiKey: aiPermitted ? aiKey : null,
        aiConfigured: aiKey !== null,
      });
      if (result.aiCalled) aiCallsUsed++;

      if (result.source === "defer") {
        // OFF missed and the AI budget is spent — keep the row for the
        // next run's budget. Not a miss, not a failure.
        skipped++;
        continue;
      }

      const { error: upsertErr } = await admin
        .from("micronutrient_profiles")
        .upsert(
          {
            user_id: userId,
            name_key: nameKey,
            values: result.values,
            source: result.source,
            source_code: offCode ?? null,
            enriched_at: new Date().toISOString(),
          },
          { onConflict: "user_id,name_key" },
        );
      if (upsertErr) throw upsertErr;

      await deleteQueueRow(admin, row.id as string);
      if (result.source === "miss") missed++;
      else if (result.source === "ai") estimated++;
      else enriched++;
    } catch {
      // Transient failure (OFF flaked, upsert raced). Bump attempts;
      // drop the row once it's exhausted its retries so a permanently
      // broken name can't wedge the queue.
      failed++;
      if (attempts + 1 >= MAX_ATTEMPTS) {
        await deleteQueueRow(admin, row.id as string);
      } else {
        await admin
          .from("micronutrient_queue")
          .update({ attempts: attempts + 1 })
          .eq("id", row.id as string);
      }
    }
  }

  return NextResponse.json({
    processed: rows.length,
    enriched,
    estimated,
    missed,
    skipped,
    failed,
  });
}

type ResolveResult = {
  values: MicronutrientValues;
  /** `defer` = OFF missed and AI wasn't permitted this run; the caller
   *  leaves the queue row for next time rather than writing a miss. */
  source: "barcode" | "search" | "ciqual" | "ai" | "miss" | "defer";
  /** Whether an AI call was actually made (so the caller can decrement
   *  the per-run budget). */
  aiCalled: boolean;
};

/** Resolve per-100g micronutrients for a food, in priority order:
 *    1. Exact OFF barcode lookup (when the queue row carried a code).
 *    2. OFF name search, median across the top matches.
 *    3. AI estimate — only when `opts.aiKey` is provided (configured +
 *       under the per-run cap).
 *  Returns `source: "miss"` when AI ran and found nothing, or
 *  `source: "defer"` when OFF missed and AI wasn't permitted. */
async function resolveMicronutrients(
  nameKey: string,
  offCode: string | undefined,
  opts: { aiKey: string | null; aiConfigured: boolean },
): Promise<ResolveResult> {
  if (offCode) {
    const result = await fetchOffProductResult(offCode);
    const product = result.status === "hit" ? result.product : null;
    if (product) {
      const values = offHitToMicronutrients(product);
      if (Object.keys(values).length > 0) {
        return { values, source: "barcode", aiCalled: false };
      }
    }
    // Barcode lookup whiffed — fall through to a name search.
  }

  // CIQUAL: curated lab micronutrients for the generic foods it covers — more
  // reliable than OFF's crowd-sourced median or an AI estimate, so it's tried
  // before the OFF name search. Misses (branded / uncovered names) fall through.
  const ciqual = await ciqualMicronutrients(nameKey);
  if (ciqual && Object.keys(ciqual).length > 0) {
    return { values: ciqual, source: "ciqual", aiCalled: false };
  }

  // Name search: median across the top hits rather than the first
  // usable one, so a single mislabelled product can't define a generic
  // name's nutrient profile.
  const hits = await searchOffHitsServer(nameKey, 10);
  const median = medianMicronutrients(hits);
  if (Object.keys(median).length > 0) {
    return { values: median, source: "search", aiCalled: false };
  }

  // OFF had nothing. Try the AI estimate if permitted this run.
  if (opts.aiKey) {
    const estimate = await estimateMicronutrientsAI(nameKey, opts.aiKey);
    if (Object.keys(estimate).length > 0) {
      return { values: estimate, source: "ai", aiCalled: true };
    }
    // AI ran but couldn't estimate — a genuine miss.
    return { values: {}, source: "miss", aiCalled: true };
  }

  // AI not permitted this run. If AI is configured at all, defer so a
  // later run with budget can try it; otherwise (no AI on this
  // deployment) record a miss so we stop re-querying a name OFF will
  // never resolve.
  return {
    values: {},
    source: opts.aiConfigured ? "defer" : "miss",
    aiCalled: false,
  };
}

async function deleteQueueRow(
  admin: SupabaseClient,
  id: string,
): Promise<void> {
  await admin.from("micronutrient_queue").delete().eq("id", id);
}
