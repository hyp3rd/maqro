import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { FEATURES } from "@/lib/billing/tiers";
import { loadUserTier } from "@/lib/billing/usage";
import { checkAuthRateLimit, ipFromRequest } from "@/lib/rate-limit";
import { matchIngredients } from "@/lib/recipe-import/match-ingredients";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Wire shape — Zod enforces the array-of-strings constraint
 *  uniformly, replacing four hand-rolled checks below. MAX_INGREDIENTS
 *  is enforced inline because the helpful error message references
 *  the runtime constant. */
const BodySchema = z.object({ ingredients: z.array(z.string()) });

/** Best-effort matcher for raw ingredient strings → catalog-resolved
 *  RecipeIngredient[]. Used by the URL-import dialog when the user
 *  ticks "Try to match ingredients" — we pre-populate the form with
 *  the best catalog matches so they're editing rows instead of
 *  rebuilding from scratch.
 *
 *  Body: `{ ingredients: string[] }` — up to 50 strings per call.
 *  Returns `{ results: IngredientMatchResult[] }` in input order.
 *
 *  Auth: signed-in only. Cheap server-side compute (no AI, no DB,
 *  no outbound HTTP) but exposing it anonymously would let
 *  scrapers data-mine our catalog. */
const MAX_INGREDIENTS = 50;

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

  // Gated behind the same paid-tier check as /api/recipes/import-from-url.
  // The matcher is only useful as a follow-up to a URL import, and
  // exposing it unrestricted lets a scraper data-mine the catalog
  // via permuted ingredient strings. Plus+ aligns the entry points.
  const tier = await loadUserTier(supabase, user.id);
  if (!FEATURES.canImportFromUrl(tier)) {
    return NextResponse.json(
      {
        error: "Ingredient matcher is a Plus / Pro feature.",
        kind: "premium-required",
        tier,
      },
      { status: 402 },
    );
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { ingredients } = parsed.data;
  if (ingredients.length === 0) {
    return NextResponse.json({ results: [] });
  }
  if (ingredients.length > MAX_INGREDIENTS) {
    return NextResponse.json(
      { error: `Up to ${MAX_INGREDIENTS} ingredients per call.` },
      { status: 400 },
    );
  }
  const cleaned = ingredients;

  // Rate limit even though the call is cheap — protects against a
  // scraper pulling our catalog by submitting permutations.
  const rateLimit = await checkAuthRateLimit({
    surface: "match-ingredients",
    ip: ipFromRequest(req),
    target: user.id,
    ipLimit: 60,
    targetLimit: 120,
    windowSeconds: 3600,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many match requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  return NextResponse.json({ results: matchIngredients(cleaned) });
}
