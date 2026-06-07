import { getAnthropicConfig } from "@/lib/ai/env";
import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { checkAndIncrementAiUsage } from "@/lib/billing/usage";
import { filterDayAssignments } from "@/lib/suggest-day";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

const MODEL: Anthropic.Model = "claude-haiku-4-5";
const MAX_TOKENS = 1024;

/** One saved recipe, reduced to the per-serving macros + labels the model
 *  needs to pick a coherent, macro-fitting day. The id is opaque — the client
 *  resolves it back to the full recipe. */
const RecipeWire = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  calories: z.number(),
  cuisine: z.string().optional(),
  diet: z.string().optional(),
});

const BodySchema = z.object({
  targets: z.object({
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    calories: z.number(),
  }),
  mealSlots: z.array(z.string().min(1)).min(1).max(8),
  recipes: z.array(RecipeWire).min(1).max(200),
});

/** "Don't know what to eat today?" — picks one of the user's OWN saved recipes
 *  for each main meal slot so the day is varied, meal-appropriate, and lands
 *  near the remaining macro targets. The model only PICKS (never invents) —
 *  it's handed the recipe ids and must return a subset. Single Anthropic call,
 *  forced `submit_day` tool. Auth + AI-feature + monthly-cap gated, same as the
 *  other AI routes. */
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

  // 2. AI feature gate.
  const ai = getAnthropicConfig();
  if (!ai) {
    return NextResponse.json(
      {
        error:
          "AI isn't configured on this deployment (ANTHROPIC_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  // 2b. Free-tier monthly cap (shared across all AI routes). 402 short-circuits
  //     before the Anthropic call.
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

  // 3. Validate body.
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { targets, mealSlots, recipes } = parsed.data;

  const recipeIds = new Set(recipes.map((r) => r.id));
  const slotSet = new Set(mealSlots);

  // 4. Build the prompt — the recipe list keyed by id, the slots, the targets.
  const recipeLines = recipes
    .map(
      (r) =>
        `- [${r.id}] ${r.name}: P${Math.round(r.protein)} C${Math.round(
          r.carbs,
        )} F${Math.round(r.fat)} ${Math.round(r.calories)}kcal${
          r.cuisine ? ` · ${r.cuisine}` : ""
        }${r.diet ? ` · ${r.diet}` : ""}`,
    )
    .join("\n");

  const systemPrompt = `You help the user decide what to eat today, choosing ONLY from their own saved recipes (listed below by id).

Pick one recipe for each main meal slot so the day is varied, meal-appropriate (breakfast-style foods at breakfast, a dinner-style dish at dinner), and the COMBINED per-serving macros land as close as possible to the remaining targets — without going far over.

Remaining targets for the rest of today: P${Math.round(
    targets.protein,
  )}g C${Math.round(targets.carbs)}g F${Math.round(targets.fat)}g ${Math.round(
    targets.calories,
  )} kcal.

Meal slots to fill (use these names exactly): ${mealSlots.join(", ")}.

Saved recipes (id · name · per-serving macros · cuisine · diet):
${recipeLines}

Rules:
- Use ONLY the recipe ids above. At most one recipe per slot.
- Prefer variety — don't repeat a recipe across slots.
- It's fine to leave a slot empty if nothing fits (e.g. a snack slot, or a thin library).
- Get the combined macros close to the targets; a modest under is better than a large over.
- Call submit_day exactly once with your assignments.`;

  const tools: Anthropic.Tool[] = [
    {
      name: "submit_day",
      description:
        "Submit the chosen recipe for each filled meal slot. Call exactly once, then stop.",
      input_schema: {
        type: "object",
        properties: {
          assignments: {
            type: "array",
            description: "One entry per slot you're filling.",
            items: {
              type: "object",
              properties: {
                slot: {
                  type: "string",
                  description: "The meal slot name, exactly as provided.",
                },
                recipe_id: {
                  type: "string",
                  description:
                    "The id of the chosen recipe, exactly as provided.",
                },
              },
              required: ["slot", "recipe_id"],
            },
          },
          note: {
            type: "string",
            description: "Optional one-sentence rationale (≤140 chars).",
          },
        },
        required: ["assignments"],
      },
    },
  ];

  const anthropic = new Anthropic({ apiKey: ai.apiKey });
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools,
      tool_choice: { type: "tool", name: "submit_day" },
      messages: [{ role: "user", content: "Pick my day. Call submit_day." }],
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
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "submit_day",
  );
  if (!toolUse) {
    return NextResponse.json(
      { error: "AI didn't return a day plan." },
      { status: 502 },
    );
  }

  // Validate every assignment against the provided slots + recipe ids (the
  // model can hallucinate an id); dedupe slots, keeping the first.
  const input = toolUse.input as {
    assignments?: { slot?: unknown; recipe_id?: unknown }[];
    note?: unknown;
  };
  const assignments = filterDayAssignments(
    input.assignments,
    slotSet,
    recipeIds,
  );
  if (assignments.length === 0) {
    return NextResponse.json(
      {
        error:
          "Couldn't build a day from your saved recipes — try adding a few more.",
      },
      { status: 422 },
    );
  }

  const note = typeof input.note === "string" ? input.note.slice(0, 140) : null;
  return NextResponse.json({ assignments, note });
}
