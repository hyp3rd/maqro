import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { FEATURES } from "@/lib/billing/tiers";
import {
  getCurrentMonthUsage,
  incrementAiUsage,
  loadUserTier,
} from "@/lib/billing/usage";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { extractRecipeWithAi } from "@/lib/recipe-import/ai-extract";
import { fetchRecipePage } from "@/lib/recipe-import/fetch";
import { isHostAllowed } from "@/lib/recipe-import/host-allowlist";
import { parseRecipeJsonLd } from "@/lib/recipe-import/jsonld";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  url: z.string().min(1),
  parseWithAi: z.boolean().optional(),
});

// Force Node.js runtime (not Edge). `fetchRecipePage` performs DNS
// resolution via `node:dns` as its load-bearing SSRF defense; that
// module is not available on the Edge runtime, and a silent drop
// would re-open the DNS-rebinding vulnerability the resolver was
// added to close. Explicit declaration so a future migration to
// Edge can't accidentally weaken this route's posture.
export const runtime = "nodejs";

/** Recipe-import-from-URL.
 *
 *  Body: `{ url, parseWithAi? }`. `parseWithAi: true` opts into an
 *  Anthropic-driven extraction pass that handles pages without
 *  schema.org markup and pulls out the prep notes / tips JSON-LD
 *  publishers usually omit. Default is false — fast, free, and
 *  covers every major recipe site that embeds JSON-LD (NYT Cooking,
 *  Bon Appétit, Serious Eats, AllRecipes, …).
 *
 *  Return shape: `{ ok, recipe, sourceUrl, source: "jsonld" | "ai" }`.
 *  The `source` field lets the UI surface which path produced the
 *  data so the operator knows whether AI usage was billed.
 *
 *  Routing logic for parseWithAi=true:
 *    1. Try JSON-LD as before — cheap, deterministic.
 *    2. Run AI extraction over the page text.
 *    3. If AI succeeded, return AI result (richer: includes prep
 *       notes, tips, time, yield — fields JSON-LD often omits).
 *    4. If AI failed but JSON-LD succeeded, return JSON-LD.
 *    5. If both failed, return 422.
 *
 *  Auth: signed-in only. The route makes a server-side fetch on
 *  behalf of the caller, which is a privileged operation.
 *
 *  Rate limit: per-IP 20/hr, per-user 30/hr. The per-IP cap is the
 *  meaningful defense (SSRF probing); the per-user cap throttles
 *  a logged-in account from exhausting our fetch budget on someone
 *  else's URL list. The AI path is ALSO gated by
 *  `checkAndIncrementAiUsage`, so free-tier users hit the same
 *  monthly cap that gates other AI features. */
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
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  // Premium-only gate. The route makes a server-side fetch of an
  // arbitrary user-supplied URL — even with the SSRF defenses
  // (validateUrl + DNS pre-check + admin allowlist + manual redirect
  // handling), each request is a potential abuse vector. Restricting
  // to Plus+ raises the bar from "anyone with an account" to "anyone
  // who put a credit card on file", which is a meaningful filter on
  // adversarial traffic while leaving the feature available to paying
  // users at no UX cost.
  const tier = await loadUserTier(supabase, user.id);
  if (!FEATURES.canImportFromUrl(tier)) {
    return NextResponse.json(
      {
        error:
          "Recipe import from URL is a Plus / Pro feature. Upgrade to enable.",
        kind: "premium-required",
        tier,
      },
      { status: 402 },
    );
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const urlInput = parsed.data.url.trim();
  if (urlInput.length === 0) {
    return NextResponse.json(
      { error: "Provide a recipe URL." },
      { status: 400 },
    );
  }
  const parseWithAi = parsed.data.parseWithAi === true;

  const rateLimit = await checkAuthRateLimit({
    surface: "recipe-import-url",
    ip: ipFromRequest(req),
    target: user.id,
    ipLimit: 20,
    targetLimit: 30,
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many imports. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  // Admin-managed hostname allowlist gate. When the table is
  // populated, restrict-mode is on and only listed hostnames (or
  // their subdomains) can be imported. Empty table = open mode and
  // this returns ok immediately. We extract the hostname here
  // (cheap) rather than passing the raw URL to isHostAllowed so the
  // allowlist module stays decoupled from URL parsing.
  let hostnameForCheck: string;
  try {
    hostnameForCheck = new URL(urlInput).hostname.toLowerCase();
  } catch {
    return NextResponse.json(
      { error: "Provide a valid URL." },
      { status: 400 },
    );
  }
  const allowlist = await isHostAllowed(hostnameForCheck);
  if (!allowlist.ok) {
    return NextResponse.json({ error: allowlist.reason }, { status: 422 });
  }

  const fetchResult = await fetchRecipePage(urlInput);
  if (!fetchResult.ok) {
    return NextResponse.json(
      { error: fetchResult.error },
      { status: fetchResult.status && fetchResult.status >= 400 ? 502 : 400 },
    );
  }

  const jsonLdRecipe = parseRecipeJsonLd(fetchResult.html);

  if (parseWithAi) {
    // AI path. Check the monthly cap first WITHOUT incrementing so
    // an over-budget caller gets the right 402 instead of consuming
    // Anthropic quota for no reason. The debit is deferred to *after*
    // the model call actually succeeds — if the vendor errors and we
    // fall back to JSON-LD, the user keeps their credit (they paid
    // for AI extraction and got none).
    const usage = await getCurrentMonthUsage(supabase, user.id);
    if (usage.cap !== null && usage.used >= usage.cap) {
      return NextResponse.json(
        {
          error: "AI usage cap reached for this month.",
          used: usage.used,
          cap: usage.cap,
          kind: "ai-cap-reached",
        },
        { status: 402 },
      );
    }
    const ai = await extractRecipeWithAi({
      html: fetchResult.html,
      sourceUrl: fetchResult.finalUrl,
    });
    if (ai) {
      if (usage.cap !== null) {
        await incrementAiUsage(supabase, user.id, usage.used);
      }
      return NextResponse.json({
        ok: true,
        recipe: ai.recipe,
        sourceUrl: fetchResult.finalUrl,
        source: "ai" as const,
      });
    }
    // AI extraction failed (no Anthropic config, tool error,
    // malformed payload). Fall through to whatever JSON-LD gave us
    // so the user isn't left empty-handed after opting in. We
    // deliberately do NOT debit `incrementAiUsage` here — the user
    // didn't get the AI result they opted into.
  }

  if (!jsonLdRecipe) {
    return NextResponse.json(
      {
        error: parseWithAi
          ? "Couldn't extract a recipe from that page, with or without AI."
          : "Couldn't find recipe data on that page. Try ticking 'Parse with AI' for sites without schema.org markup.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    recipe: jsonLdRecipe,
    sourceUrl: fetchResult.finalUrl,
    source: "jsonld" as const,
  });
}
