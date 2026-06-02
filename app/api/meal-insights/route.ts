import { getAnthropicConfig } from "@/lib/ai/env";
import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { FEATURES } from "@/lib/billing/tiers";
import { checkAndIncrementAiUsage, loadUserTier } from "@/lib/billing/usage";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

/** "AI advice" for the meal-detail view. Takes a single meal's macro /
 *  sub-macro / micronutrient profile plus the deterministic flags the
 *  client already computed, and returns 2–3 short, concrete "next time"
 *  suggestions in plain language.
 *
 *  Pro-gated (it leans on micronutrient data, a Pro feature) and
 *  metered against the shared monthly AI cap, like every other AI
 *  route. The deterministic flags work offline for free users; this is
 *  the optional richer layer. */
const MODEL: Anthropic.Model = "claude-haiku-4-5-20251001";
export const maxDuration = 30;
const MAX_TOKENS = 400;

const MealSchema = z
  .object({
    name: z.string().min(1).max(60),
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    addedSugars: z.number().optional(),
    fiber: z.number().optional(),
    saturatedFat: z.number().optional(),
    foods: z
      .array(z.object({ name: z.string(), grams: z.number() }).loose())
      .max(40),
    /** Per-nutrient % of the user's daily target, e.g. `{ vitaminC: 88 }`. */
    microPctOfTarget: z.record(z.string(), z.number()).optional(),
  })
  .loose();

const BodySchema = z.object({
  meal: MealSchema,
  /** The deterministic flag titles the client already shows, so the
   *  model grounds its advice in the same read rather than re-deriving. */
  flags: z.array(z.string().max(80)).max(12).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Auth gate.
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

  // 2. AI gate.
  const ai = getAnthropicConfig();
  if (!ai) {
    return NextResponse.json(
      {
        error:
          "AI meal advice isn't configured on this deployment (ANTHROPIC_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  // 3. Pro gate — checked BEFORE metering so a rejected call isn't
  //    counted against anyone's quota.
  const tier = await loadUserTier(supabase, user.id);
  if (!FEATURES.canTrackMicronutrients(tier)) {
    return NextResponse.json(
      { error: "AI meal advice is a Pro feature.", kind: "pro-required" },
      { status: 403 },
    );
  }

  // 4. Free-tier monthly cap (shared across all AI routes).
  const usage = await checkAndIncrementAiUsage(supabase, user.id);
  if (!usage.allowed) {
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

  // 5. Validate body.
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { meal, flags } = parsed.data;

  // 6. Build the prompt. The numbers are the grounding; the flags are
  //    the read; the ask is for actionable swaps, not a recap.
  const microLines = meal.microPctOfTarget
    ? Object.entries(meal.microPctOfTarget)
        .map(([k, pct]) => `${k}: ${Math.round(pct)}% of daily`)
        .join(", ")
    : "";
  const summary = [
    `Meal: ${meal.name}`,
    `Foods: ${meal.foods.map((f) => `${f.name} (${f.grams}g)`).join(", ") || "—"}`,
    `Calories ${Math.round(meal.calories)}, protein ${Math.round(meal.protein)}g, carbs ${Math.round(meal.carbs)}g, fat ${Math.round(meal.fat)}g`,
    typeof meal.fiber === "number" ? `Fiber ${meal.fiber}g` : null,
    typeof meal.saturatedFat === "number"
      ? `Saturated fat ${meal.saturatedFat}g`
      : null,
    typeof meal.addedSugars === "number"
      ? `Added sugar ${meal.addedSugars}g`
      : null,
    microLines ? `Micronutrients — ${microLines}` : null,
    flags && flags.length > 0 ? `Detected flags: ${flags.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = [
    "You are a concise, practical nutrition coach.",
    "Given ONE meal's nutrition profile, give 2–3 short, concrete suggestions to improve its balance NEXT TIME the user eats something similar.",
    "Rules:",
    "- Name specific foods/swaps (e.g. 'add a handful of berries', 'swap to Greek yogurt').",
    "- Address the detected flags first; if the meal is already well-balanced, say so in one line and add one optional tweak.",
    "- Do NOT restate the numbers back. Be actionable, not descriptive.",
    "- No medical claims, no diagnoses. Keep the whole reply under 70 words.",
    "- Plain text, one suggestion per line, no markdown headers.",
  ].join("\n");

  try {
    const client = new Anthropic(ai);
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: summary }],
    });
    const advice = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!advice) {
      return NextResponse.json(
        { error: "No advice was generated. Try again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ advice });
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach the AI service. Try again." },
      { status: 502 },
    );
  }
}
