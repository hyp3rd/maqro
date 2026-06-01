import { markLastBlockForCache } from "@/lib/ai/anthropic-helpers";
import { getAnthropicConfig } from "@/lib/ai/env";
import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { checkAndIncrementAiUsage } from "@/lib/billing/usage";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

// Sonnet 4.6 — same vision model as identify-meal. Recognizing grocery
// items on a shelf is the same class of task as identifying a plated
// meal; Sonnet's finer-grained labelling is worth the cost here too.
const MODEL: Anthropic.Model = "claude-sonnet-4-6";
export const maxDuration = 60;
const MAX_TOKENS = 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic's documented limit.
const MAX_ITEMS = 30;

/** One pantry item identified in a photo. Unlike the meal route, there
 *  are NO macros — pantry items are inventory, not logged foods, so we
 *  return just the name + a rough count + the unit the model thinks
 *  fits ("eggs", "cans", "g"). Quantities from a photo are inherently
 *  rough; the review dialog lets the user correct every field before
 *  anything is saved. */
export type ResolvedPantryItem = {
  name: string;
  quantity: number;
  unit: string;
  confidence: "high" | "medium" | "low";
};

export type ResolvedPantryScan = { items: ResolvedPantryItem[] };

const BodySchema = z.object({
  imageBase64: z.string().min(1),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

type AiSubmittedItem = {
  name?: unknown;
  quantity?: unknown;
  unit?: unknown;
  confidence?: unknown;
};
type AiSubmission = { items?: AiSubmittedItem[] };

/** Identify grocery / pantry items in a photo of a fridge, shelf, or
 *  counter via Claude Sonnet 4.6 vision. Returns a flat list of item
 *  names + rough counts the user reviews before committing to their
 *  pantry. No catalog resolution, no macro estimation, no plausibility
 *  loop — the output is inventory the user edits, not nutrition data.
 *
 *  Auth-gated + AI-feature-gated like the other AI routes; counts
 *  toward the shared monthly generation cap. */
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
          "AI pantry scanning isn't configured on this deployment (ANTHROPIC_API_KEY missing).",
      },
      { status: 503 },
    );
  }

  // 2b. Free-tier monthly cap (shared across all AI routes). 402
  //     short-circuits before image decode / Anthropic call.
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

  // 3. Validate body. Schema gates shape + the MIME enum; the image
  //    size cap stays inline because it references MAX_IMAGE_BYTES.
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const approxBytes = Math.floor((body.imageBase64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: `Image too large (${Math.round(approxBytes / 1024)} KB). Max ${MAX_IMAGE_BYTES / 1024} KB.`,
      },
      { status: 413 },
    );
  }

  const systemPrompt = `You are identifying grocery / pantry items in a photo the user took of their fridge, shelf, counter, or grocery haul. The user wants to inventory what they have — NOT log a meal.

For each distinct item you can see, return:
- a short, concrete name (e.g. "Eggs", "Whole milk", "Canned chickpeas", "Olive oil") — the everyday name a person would write on a shopping list, not a brand slogan
- a quantity: how many of that item are visible. Count discrete units (6 eggs → 6; 2 cans → 2). For something you can't count as units (a bag of rice, a tub of yogurt), use 1.
- a unit: the natural unit for the quantity. Use the countable noun for discrete items ("eggs", "cans", "bottles", "apples"); use "pack"/"bag"/"tub"/"jar" for containers; fall back to "item" only when nothing better fits. Do NOT estimate weights in grams — a photo can't tell 200 g of rice from 2 kg.
- a confidence: "high" if the item + count are clearly visible, "medium" if you're inferring (partially obscured, label not fully readable), "low" if it's a guess.

Rules:
- Up to ${MAX_ITEMS} items. Group identical items into one row with a count (don't list "Egg" six times).
- Skip non-food objects (plates, utensils, the fridge itself).
- Don't invent items you can't actually see. A shorter accurate list beats a padded one.
- When in doubt about quantity, use 1 and set confidence to "low" so the user knows to check.`;

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
        text: "Identify the pantry items in this photo and submit via submit_pantry_items.",
      },
    ],
  };
  markLastBlockForCache(userMessage);

  const tool: Anthropic.Tool = {
    name: "submit_pantry_items",
    description:
      "Final output: the pantry / grocery items you identified, each with a rough count + unit. Required.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: `Identified items. Up to ${MAX_ITEMS}.`,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Everyday item name." },
              quantity: {
                type: "number",
                description: "How many visible. >= 0.",
              },
              unit: {
                type: "string",
                description:
                  "Natural unit ('eggs', 'cans', 'bag', 'item'). Never grams.",
              },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["name", "quantity", "unit"],
          },
        },
      },
      required: ["items"],
    },
  };

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
      tools: [tool],
      tool_choice: { type: "tool", name: "submit_pantry_items" },
      messages: [userMessage],
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

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "submit_pantry_items") {
    return NextResponse.json(
      {
        error: `AI returned no submission (stop_reason=${response.stop_reason}).`,
      },
      { status: 502 },
    );
  }

  const submitted = toolUse.input as AiSubmission;
  const rawItems = Array.isArray(submitted.items) ? submitted.items : [];
  const items: ResolvedPantryItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw.name !== "string") continue;
    const name = cleanName(raw.name);
    if (!name) continue;
    items.push({
      name,
      quantity: clampQuantity(raw.quantity),
      unit: cleanUnit(raw.unit),
      confidence: normalizeConfidence(raw.confidence),
    });
    if (items.length >= MAX_ITEMS) break;
  }

  const out: ResolvedPantryScan = { items };
  return NextResponse.json(out);
}

/** Coerce the AI's quantity to a sane non-negative integer. Photos
 *  can't justify fractional counts, so we round; out-of-range / NaN
 *  collapses to 1 (the "I see one of these" default). Capped so a
 *  hallucinated 9999 doesn't reach the UI. */
function clampQuantity(q: unknown): number {
  if (typeof q !== "number" || !Number.isFinite(q) || q < 0) return 1;
  return Math.min(Math.round(q), 9999);
}

function normalizeConfidence(c: unknown): "high" | "medium" | "low" {
  return c === "high" || c === "medium" || c === "low" ? c : "medium";
}

/** Tidy an AI-returned item name: trim, drop trailing punctuation,
 *  capitalize. Mirrors identify-meal's `cleanName`. */
function cleanName(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/[.,;:]+$/, "")
    .slice(0, 200);
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

/** Normalize the unit: trim, lowercase, cap length. Blank → "item" so
 *  the row always renders sensibly. Never grams (the prompt forbids
 *  it, but defend anyway in case the model ignores us). */
function cleanUnit(raw: unknown): string {
  if (typeof raw !== "string") return "item";
  const trimmed = raw.trim().toLowerCase().slice(0, 40);
  return trimmed || "item";
}
