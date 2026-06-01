import type { Food } from "@/components/macro/types";
import { foodDatabase } from "@/data/food-database";
import { markLastBlockForCache } from "@/lib/ai/anthropic-helpers";
import { getAnthropicConfig } from "@/lib/ai/env";
import {
  type EstimatedItem,
  validatePhotoMacros,
} from "@/lib/ai/photo-validator";
import { buildNormIndex, matchPick } from "@/lib/ai/plan";
import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { checkAndIncrementAiUsage } from "@/lib/billing/usage";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

// Sonnet 4.6 - vision is the load-bearing capability here and Haiku 4.5
// kept producing the same failure modes (collapsed composite dishes,
// implausible portions, miscategorized condiments). Sonnet identifies
// finer-grained foods and reacts well to validator feedback. The route
// is auth-gated + AI-gated, so cost is bounded by signed-in usage.
const MODEL: Anthropic.Model = "claude-sonnet-4-6";
/** Vercel function timeout (seconds). Vision calls on Sonnet take
 *  ~3–8s; with up to 3 iterations + tool round-trips we need headroom
 *  above the default. 60s is the Hobby ceiling and the Pro default. */
export const maxDuration = 60;
/** Hard cap on the agent loop. Most photos resolve in one iteration;
 *  the loop only retries when the macro-plausibility validator catches
 *  something fishy. Forced-submit on the final iteration guarantees a
 *  response. */
const MAX_ITERATIONS = 3;
/** Per-iteration response cap. The model returns a small JSON payload
 *  plus optional preamble - 1024 tokens is plenty. */
const MAX_TOKENS_PER_ITERATION = 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic's documented limit.

/** A single food identified in the photo. The client uses per-100g +
 *  portionGrams so the user can edit grams in the review dialog and
 *  macros recompute locally.
 *
 *  When `estimated` is true, the macros came from the model rather
 *  than the catalog - surface that to the user with a clear badge so
 *  they can correct or skip. We allow this exception to the usual
 *  "catalog is the only source of macros" rule because the user is
 *  identifying what's already on their plate; refusing to add a
 *  tomato just because tomato isn't pre-seeded would be worse than
 *  giving them an editable estimate. Estimated foods can be promoted
 *  to custom foods on confirm so the next photo of the same food
 *  resolves to the catalog instead. */
export type ResolvedMealPhotoFood = {
  name: string;
  per100g: { protein: number; carbs: number; fat: number; calories: number };
  portionGrams: number;
  confidence: "high" | "medium" | "low";
  /** True when macros came from the model, false when they came from
   *  the seed/custom catalog. */
  estimated: boolean;
};

export type ResolvedMealPhoto = { foods: ResolvedMealPhotoFood[] };

/** Wire shape for the camera-identify endpoint. Schema enforces the
 *  enum for the MIME type up front (the model only accepts these
 *  three) and gates the base64 string to non-empty. The image-size
 *  check stays inline since it depends on a runtime constant. */
const FoodWire = z
  .object({
    name: z.string().min(1),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    calories: z.number(),
  })
  .loose();

const BodySchema = z.object({
  imageBase64: z.string().min(1),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dietPreference: z
    .enum(["omnivore", "vegetarian", "vegan", "pescatarian", "carnivore"])
    .optional(),
  customFoods: z.array(FoodWire).optional(),
});

type BodyForRoute = Omit<z.infer<typeof BodySchema>, "customFoods"> & {
  customFoods?: Food[];
};

type AiSubmittedFood = {
  name: string;
  portionGrams: number;
  confidence?: "high" | "medium" | "low";
  /** Per-100g macros the AI estimates. Required for every food so we
   *  can fall back to these for items not in the catalog. */
  macrosPer100g?: {
    protein?: number;
    carbs?: number;
    fat?: number;
    calories?: number;
  };
};

type AiSubmission = { foods?: AiSubmittedFood[] };

/** Identify foods in a meal photo via Claude Sonnet 4.6 vision in a
 *  small agent loop. The model returns names + portion estimates + per-
 *  100g macros; we resolve each name against the seed catalog using the
 *  same `matchPick` semantics as the meal-plan and recipe routes.
 *  Matched names use catalog macros (truth). Unmatched names use the
 *  AI's per-100g estimates, but only after passing
 *  `validatePhotoMacros` - implausible estimates (impossible macro
 *  sums, kcal that doesn't match macros, oil claimed as protein) get
 *  fed back to the model on retry.
 *
 *  Auth-gated + AI-feature-gated like the other AI routes. */
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
          "AI meal identification isn't configured on this deployment (ANTHROPIC_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  // 2b. Free-tier monthly cap (shared across all three AI routes).
  //     402 short-circuits before image decode / Anthropic call.
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

  // 3. Validate body. Schema enforces shape, MIME enum, and the
  //    presence of the base64 string; the image-size cap below stays
  //    inline because it depends on the runtime MAX_IMAGE_BYTES.
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data as BodyForRoute;
  // Rough byte estimate - base64 inflates by ~33% so multiply back.
  const approxBytes = Math.floor((body.imageBase64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: `Image too large (${Math.round(approxBytes / 1024)} KB). Max ${MAX_IMAGE_BYTES / 1024} KB.`,
      },
      { status: 413 },
    );
  }

  // 4. Build the catalog. NB: no diet filter here - the user is
  //    identifying what's already on the plate, not asking for
  //    suggestions.
  const catalog: Food[] = [...foodDatabase, ...(body.customFoods ?? [])];
  const catalogLines = catalog
    .map(
      (f) =>
        `- ${f.name}: P${f.protein} C${f.carbs} F${f.fat} ${f.calories}kcal`,
    )
    .join("\n");

  const systemPrompt = `You are identifying foods in a photograph the user took of their meal before eating. Accuracy of portion grams matters more than completeness - a missed pickle is fine; a 600 g rice estimate for a 150 g portion is not.

Think through these steps before submitting:

1. **Identify the container.** Plate, bowl, takeout box, cup? Note its approximate size - a dinner plate is ~25 cm / 10 in across, a side plate ~18 cm / 7 in, a coffee mug ~250 ml, a standard bowl ~400 ml. Use it as your visual ruler for the foods inside.

2. **List each visible food, specifically.** "White rice" not "rice"; "grilled salmon" not "fish"; "scrambled egg" not "egg dish". When a food matches one in the seed catalog below, USE THE EXACT CATALOG NAME - the server will substitute the catalog's macros for yours.

3. **Decompose composite dishes.** A sandwich is bread + filling + condiments, not one item. A burrito bowl is rice + beans + meat + salsa + cheese. A salad is greens + each topping + dressing. The user can edit the list but cannot recover detail you collapsed into a single name.

4. **Estimate grams per food using the container as scale.** Common references:
  - Plate fully covered, single layer of grain/pasta: ~100–150 g cooked
  - Palm-sized portion of meat/fish (no thumb): ~100–120 g
  - Standard mug of cooked rice (filled): ~200 g
  - Cooked vegetables, side portion: ~80–150 g
  - **Oils, dressings, sauces shown as a sheen or drizzle: 5–15 g - NOT 100 g.** A real "pour" of dressing is 20–30 g. Pure oil portions above ~50 g are almost never correct.
  - Cooked grains/pasta/legumes are ~2.5–3× their raw weight. Estimate what you see (cooked weight), not the dry equivalent.
  - Plain water, black coffee, plain tea: skip them (0 macros, no value to logging).

5. **For each food, give per-100 g macros.** These are used only when the name doesn't match the catalog. Reality checks:
  - Pure carbs (cooked rice, pasta, bread, potato): protein 2–10 g, fat 0–3 g, carbs 20–60 g, calories 100–350
  - Meat / fish (chicken, beef, salmon, tuna, etc.): protein 18–30 g, carbs 0–2 g, fat 3–25 g, calories 100–300
  - Pure fats (olive oil, butter, ghee, mayo): fat 80–100 g, protein/carbs ~0, calories 800–900
  - Dairy: yogurt 4–10 g protein; cheese 20–30 g protein, 25–35 g fat
  - Vegetables: low across the board, calories 15–60
  - **The macro grams (P + C + F) must sum to ≤ 100 g per 100 g of food.** If your sum is over, your estimate is wrong.
  - **Calories ≈ 4·P + 4·C + 9·F (within 30%).** If they don't match, recheck.

6. **Confidence per food:**
  - "high" - clearly identified, common food, portion accurate to ±20%
  - "medium" - right category but ambiguous (e.g. "white fish" - cod or tilapia?), or portion is rough
  - "low" - guess. Tag it so the user knows to verify or remove.

7. **Skip anything you can't reasonably identify or estimate.** Better to return 4 high-confidence foods than 8 with two low-confidence guesses inflating the totals.

8. **Pre-flight check before calling submit_meal_foods:**
  - Have you decomposed every composite dish?
  - Is every per-100 g macro sum ≤ 100 g?
  - Do calories match macros for each food?
  - Are any oils/dressings claimed at > 50 g portions? Recheck.

Seed catalog (per 100 g):
${catalogLines}

When you're satisfied with the answer, call submit_meal_foods. The server validates your macros for plausibility - if it catches an error, it will reply with the specific issue and you should correct that food on the next call.`;

  const tool: Anthropic.Tool = {
    name: "submit_meal_foods",
    description:
      "Final output: the foods you identified with portion grams + per-100g macros. Required.",
    input_schema: {
      type: "object",
      properties: {
        foods: {
          type: "array",
          description: "Identified foods. 1–8 items.",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Food name - prefer the exact seed-catalog name when applicable.",
              },
              portionGrams: {
                type: "number",
                description: "Estimated portion in grams (5–500).",
              },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              macrosPer100g: {
                type: "object",
                description:
                  "Per-100g macros. Used directly when the food isn't in the seed catalog; otherwise the catalog values win.",
                properties: {
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                  calories: { type: "number" },
                },
                required: ["protein", "carbs", "fat", "calories"],
              },
            },
            required: ["name", "portionGrams", "macrosPer100g"],
          },
        },
      },
      required: ["foods"],
    },
  };

  // 5. Initial user message - image + instruction. Cache the image
  //    block so retry iterations don't re-pay for the (large) vision
  //    input. The instruction text is separate so the model sees it as
  //    its own block.
  const userMessage: Anthropic.MessageParam = {
    role: "user",
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: body.mediaType,
          data: body.imageBase64,
        },
      },
      {
        type: "text",
        text: "Identify the foods in this photo and submit via submit_meal_foods.",
      },
    ],
  };
  markLastBlockForCache(userMessage);

  // 6. Agent loop. Each iteration: model returns a submission, we
  //    resolve names against the catalog, run the validator on the
  //    AI-macro items, and either accept or feed the issues back.
  const anthropic = new Anthropic({ apiKey: ai.apiKey });
  const messages: Anthropic.MessageParam[] = [userMessage];
  const byNorm = buildNormIndex(catalog);
  let finalResolved: ResolvedMealPhotoFood[] | null = null;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const isLastIteration = iter === MAX_ITERATIONS - 1;
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS_PER_ITERATION,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [tool],
        tool_choice: { type: "tool", name: "submit_meal_foods" },
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        return NextResponse.json(
          { error: "AI is rate-limited. Try again shortly." },
          { status: 429 },
        );
      }
      if (err instanceof Anthropic.AuthenticationError) {
        return NextResponse.json(
          { error: "AI authentication failed - check ANTHROPIC_API_KEY." },
          { status: 503 },
        );
      }
      const message = err instanceof Error ? err.message : "AI request failed.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse || toolUse.name !== "submit_meal_foods") {
      return NextResponse.json(
        {
          error: `AI returned no submission (stop_reason=${response.stop_reason}).`,
        },
        { status: 502 },
      );
    }

    const submitted = toolUse.input as AiSubmission;
    const aiFoods = Array.isArray(submitted.foods) ? submitted.foods : [];

    // Resolve names against the catalog AND collect AI-estimated items
    // for plausibility validation. Matched items skip the validator -
    // their macros come from the catalog, not the model.
    const resolved: ResolvedMealPhotoFood[] = [];
    const estimatedItems: { resolvedIndex: number; item: EstimatedItem }[] = [];

    for (const item of aiFoods) {
      if (
        !item ||
        typeof item.name !== "string" ||
        typeof item.portionGrams !== "number"
      ) {
        continue;
      }
      const food = matchPick(item.name, catalog, byNorm);
      if (food) {
        resolved.push({
          name: food.name,
          per100g: {
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            calories: food.calories,
          },
          portionGrams: clampGrams(item.portionGrams),
          confidence: normalizeConfidence(item.confidence),
          estimated: false,
        });
        continue;
      }
      const aiMacros = sanitizeMacros(item.macrosPer100g);
      if (!aiMacros) continue;
      const clampedGrams = clampGrams(item.portionGrams);
      const resolvedIndex = resolved.length;
      resolved.push({
        name: cleanName(item.name),
        per100g: aiMacros,
        portionGrams: clampedGrams,
        confidence: normalizeConfidence(item.confidence),
        estimated: true,
      });
      estimatedItems.push({
        resolvedIndex,
        item: {
          name: cleanName(item.name),
          portionGrams: clampedGrams,
          macros: aiMacros,
        },
      });
    }

    // Run the plausibility validator only on AI-estimated items.
    const issues = validatePhotoMacros(estimatedItems.map((e) => e.item));

    if (issues.length > 0 && !isLastIteration) {
      // Feed the issues back as a tool_result is_error so the model
      // self-corrects on the next iteration. Same pattern as the
      // meal-plan route's coherence loop. The image stays cached on
      // the initial user message - we only send the textual feedback.
      const feedback: Anthropic.MessageParam = {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `The macros you submitted have plausibility problems. Fix them and submit again with corrected per-100g macros and/or portion grams.\n${issues
              .map((i) => `- ${i.message}`)
              .join("\n")}`,
          },
        ],
      };
      markLastBlockForCache(feedback);
      messages.push(feedback);
      continue;
    }

    // Either no issues OR we've exhausted retries. Accept the
    // submission as-is. Drop the worst-violating AI-estimated items on
    // the final iteration if they still failed validation - we'd
    // rather ship a shorter clean list than expose obviously-wrong
    // macros to the user.
    if (issues.length > 0 && isLastIteration) {
      const badIndices = new Set(
        issues.map((i) => estimatedItems[i.index]?.resolvedIndex ?? -1),
      );
      finalResolved = resolved.filter((_, i) => !badIndices.has(i));
    } else {
      finalResolved = resolved;
    }
    break;
  }

  const out: ResolvedMealPhoto = { foods: finalResolved ?? [] };
  return NextResponse.json(out);
}

function clampGrams(g: number): number {
  if (!Number.isFinite(g)) return 100;
  // Round to nearest 5 g, clamp [5, 500] - same grid the deterministic
  // planner uses.
  const snapped = Math.round(g / 5) * 5;
  return Math.max(5, Math.min(500, snapped));
}

function normalizeConfidence(c: unknown): "high" | "medium" | "low" {
  return c === "high" || c === "medium" || c === "low" ? c : "medium";
}

/** Tidy up an AI-returned food name into something we'd be happy
 *  saving as a custom food. Capitalizes the first letter, trims, drops
 *  trailing punctuation. Doesn't reshape the user-facing string
 *  beyond cosmetics - we want the model's noun, not our reinterpretation. */
function cleanName(raw: string): string {
  const trimmed = raw.trim().replace(/[.,;:]+$/, "");
  if (!trimmed) return raw;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

type AiMacros = NonNullable<AiSubmittedFood["macrosPer100g"]>;

/** Validate the AI's per-100g macros. Returns the cleaned shape or
 *  `null` if any required field is missing / non-finite / negative.
 *  All-zero is allowed (water, plain tea) - the user can always edit. */
function sanitizeMacros(
  m: AiMacros | undefined,
): { protein: number; carbs: number; fat: number; calories: number } | null {
  if (!m) return null;
  const isOk = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!isOk(m.protein) || !isOk(m.carbs) || !isOk(m.fat) || !isOk(m.calories)) {
    return null;
  }
  // Cap at sane upper bounds so a hallucinated 9999 doesn't poison the
  // sums in the review dialog.
  return {
    protein: Math.min(m.protein, 100),
    carbs: Math.min(m.carbs, 100),
    fat: Math.min(m.fat, 100),
    calories: Math.min(m.calories, 900),
  };
}
