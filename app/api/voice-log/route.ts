import type {
  ResolvedMealPhoto,
  ResolvedMealPhotoFood,
} from "@/app/api/identify-meal/route";
import type { Food } from "@/components/macro/types";
import { foodDatabase } from "@/data/food-database";
import { getAnthropicConfig } from "@/lib/ai/env";
import { buildNormIndex, matchPick } from "@/lib/ai/plan";
import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { checkAndIncrementAiUsage } from "@/lib/billing/usage";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

/** Voice-meal log: parse a natural-language utterance ("I had
 *  200 grams of chicken and a banana") into structured foods.
 *
 *  Mirrors `/api/identify-meal`'s output shape — `ResolvedMealPhoto`
 *  with the same `ResolvedMealPhotoFood[]` rows — so the existing
 *  `MealPhotoReviewDialog` can render either source without
 *  modification. Catalog matching is the same `matchPick` pass
 *  used everywhere else; foods not in the catalog get
 *  AI-estimated per-100g macros with the same caps/sanitisation.
 *
 *  Why a separate route from identify-meal:
 *
 *    - The system prompt is entirely different. Photo ID's hard
 *      part is portion estimation from a 2D image; voice's hard
 *      part is mapping fuzzy descriptions to specific foods
 *      ("big bowl of pasta" → ~200 g cooked, "a glass of milk"
 *      → 240 ml ≈ 245 g whole milk). The two prompts have almost
 *      no overlap.
 *
 *    - No plausibility-retry loop. Voice transcripts are
 *      structured (the user usually says the grams themselves),
 *      and a retry on a parsing error rarely helps — better to
 *      let the user see the AI's first interpretation in the
 *      review dialog and edit there.
 *
 *  Auth-gated + AI-gated like all other AI routes; counts toward
 *  the user's monthly generation cap. */
const MODEL: Anthropic.Model = "claude-haiku-4-5-20251001";
export const maxDuration = 30;
const MAX_TOKENS = 1024;
const MAX_TRANSCRIPT_CHARS = 1000;

const FoodWire = z
  .object({
    name: z.string().min(1),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    calories: z.number(),
  })
  .loose();

/** Wire shape for the voice-log endpoint. Transcript length is
 *  bounded both at the Zod layer (cheap reject for absurd payloads)
 *  and inline below (project-specific MAX_TRANSCRIPT_CHARS, which is
 *  the friendlier ceiling). */
const BodySchema = z.object({
  transcript: z.string(),
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
  macrosPer100g?: {
    protein?: number;
    carbs?: number;
    fat?: number;
    calories?: number;
  };
};

type AiSubmission = { foods?: AiSubmittedFood[] };

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
          "AI voice logging isn't configured on this deployment (ANTHROPIC_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  // 2b. Free-tier monthly cap (shared across all AI routes).
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

  // 3. Validate body. Schema guarantees `transcript` is a string;
  //    we still trim + non-empty-check inline because the project
  //    treats whitespace-only as "missing", and Zod's `.min(1)`
  //    couldn't express that without a custom refinement.
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data as BodyForRoute;
  const transcript = body.transcript.trim();
  if (!transcript) {
    return NextResponse.json({ error: "Missing transcript." }, { status: 400 });
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      {
        error: `Transcript too long (${transcript.length} chars). Max ${MAX_TRANSCRIPT_CHARS}.`,
      },
      { status: 413 },
    );
  }

  // 4. Build the catalog.
  const catalog: Food[] = [...foodDatabase, ...(body.customFoods ?? [])];
  const catalogLines = catalog
    .map(
      (f) =>
        `- ${f.name}: P${f.protein} C${f.carbs} F${f.fat} ${f.calories}kcal`,
    )
    .join("\n");

  const systemPrompt = `You convert a spoken meal description into a structured food list with portion grams.

The user dictated what they ate. Your job is to parse it into discrete foods, each with a portion in grams.

Rules:

1. **Map fuzzy quantities to grams.** When the user gives a number, use it. When they don't, fall back to common portion conventions:
  - 1 slice of bread: ~30 g · 1 medium banana: ~120 g · 1 medium apple: ~180 g
  - 1 large egg: ~50 g (whole) · 1 cup cooked rice: ~200 g · 1 cup cooked pasta: ~200 g
  - 1 cup salad greens: ~30 g · 1 tbsp oil/butter: ~15 g · 1 tsp: ~5 g
  - "A handful" of nuts: ~30 g · "A glass" of milk/juice: ~240 g
  - "A bowl" of soup: ~300 g · "A scoop" protein powder: ~30 g
  - "A small/medium/large" portion of meat: 80 / 120 / 180 g cooked
  - Pure water, plain coffee, plain tea: skip them (zero macros, no value to log)

2. **Be specific.** "Chicken breast" not "chicken"; "white rice" not "rice"; "scrambled egg" not "egg dish". If the user gives a brand or specific variant, keep it.

3. **Decompose composite descriptions.** A sandwich is bread + filling. A salad is greens + each topping + dressing. The user can edit the list but cannot recover detail you collapsed into one item.

4. **Match the catalog when you can.** When a food matches one in the seed catalog below, USE THE EXACT CATALOG NAME — the server substitutes the catalog's macros for yours.

5. **For each food, give per-100 g macros.** Used only when the name doesn't match the catalog. Reality checks:
  - Pure carbs (cooked rice, pasta, bread, potato): protein 2–10 g, fat 0–3 g, carbs 20–60 g, calories 100–350
  - Meat / fish: protein 18–30 g, carbs 0–2 g, fat 3–25 g, calories 100–300
  - Pure fats (olive oil, butter): fat 80–100 g, calories 800–900
  - Dairy: yogurt 4–10 g protein; cheese 20–30 g protein, 25–35 g fat
  - **P + C + F must sum to ≤ 100 g per 100 g of food.**
  - **Calories ≈ 4·P + 4·C + 9·F (within 30%).**

6. **Confidence per food:**
  - "high" — user said both food and quantity explicitly
  - "medium" — user said the food, you inferred quantity from a convention (e.g. "a slice")
  - "low" — ambiguous food or made-up quantity. Tag it so the user can fix.

7. **If the transcript is gibberish or unparseable**, submit an empty foods list. Don't invent meals.

Seed catalog (per 100 g):
${catalogLines}

Submit via submit_voice_foods. One pass — no retries.`;

  const tool: Anthropic.Tool = {
    name: "submit_voice_foods",
    description:
      "Final output: foods parsed from the spoken transcript with portion grams + per-100g macros.",
    input_schema: {
      type: "object",
      properties: {
        foods: {
          type: "array",
          description: "Parsed foods. 0–10 items.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              portionGrams: {
                type: "number",
                description: "Estimated portion in grams (5–500).",
              },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              macrosPer100g: {
                type: "object",
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

  const anthropic = new Anthropic({ apiKey: ai.apiKey });
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: "submit_voice_foods" },
      messages: [
        {
          role: "user",
          content: `Diet preference: ${body.dietPreference ?? "no preference"}\n\nTranscript: "${transcript}"\n\nParse the foods from the transcript.`,
        },
      ],
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
        { error: "AI authentication failed — check ANTHROPIC_API_KEY." },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : "AI request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "submit_voice_foods") {
    return NextResponse.json(
      {
        error: `AI returned no submission (stop_reason=${response.stop_reason}).`,
      },
      { status: 502 },
    );
  }

  const submitted = toolUse.input as AiSubmission;
  const aiFoods = Array.isArray(submitted.foods) ? submitted.foods : [];

  const byNorm = buildNormIndex(catalog);
  const resolved: ResolvedMealPhotoFood[] = [];
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
    resolved.push({
      name: cleanName(item.name),
      per100g: aiMacros,
      portionGrams: clampGrams(item.portionGrams),
      confidence: normalizeConfidence(item.confidence),
      estimated: true,
    });
  }

  const out: ResolvedMealPhoto = { foods: resolved };
  return NextResponse.json(out);
}

function clampGrams(g: number): number {
  if (!Number.isFinite(g)) return 100;
  const snapped = Math.round(g / 5) * 5;
  return Math.max(5, Math.min(500, snapped));
}

function normalizeConfidence(c: unknown): "high" | "medium" | "low" {
  return c === "high" || c === "medium" || c === "low" ? c : "medium";
}

function cleanName(raw: string): string {
  const trimmed = raw.trim().replace(/[.,;:]+$/, "");
  if (!trimmed) return raw;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

type AiMacros = NonNullable<AiSubmittedFood["macrosPer100g"]>;

function sanitizeMacros(
  m: AiMacros | undefined,
): { protein: number; carbs: number; fat: number; calories: number } | null {
  if (!m) return null;
  const isOk = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!isOk(m.protein) || !isOk(m.carbs) || !isOk(m.fat) || !isOk(m.calories)) {
    return null;
  }
  return {
    protein: Math.min(m.protein, 100),
    carbs: Math.min(m.carbs, 100),
    fat: Math.min(m.fat, 100),
    calories: Math.min(m.calories, 900),
  };
}
