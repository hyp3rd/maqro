import {
  MICRONUTRIENTS,
  MICRONUTRIENT_KEYS,
  type MicronutrientKey,
} from "@/lib/rda";
import Anthropic from "@anthropic-ai/sdk";
import type { MicronutrientValues } from "./types";

/** Cheap text model for the estimate — this is a low-stakes "what's a
 *  typical per-100g value" guess, not a reasoning task, so Haiku is the
 *  right cost/quality point. */
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 400;

/** Build the tool schema once: one optional number per nutrient, in the
 *  nutrient's canonical unit, so the model returns values we can store
 *  without conversion. Optional (not required) so the model can omit a
 *  nutrient it genuinely can't estimate rather than inventing a zero. */
function buildTool(): Anthropic.Tool {
  const properties: Record<string, { type: "number"; description: string }> =
    {};
  for (const key of MICRONUTRIENT_KEYS) {
    const meta = MICRONUTRIENTS[key];
    properties[key] = {
      type: "number",
      description: `${meta.label} per 100 g, in ${meta.unit}. Omit if you cannot estimate it.`,
    };
  }
  return {
    name: "submit_micronutrients",
    description:
      "Submit estimated per-100g micronutrient values for the food. Omit any nutrient you cannot reasonably estimate.",
    input_schema: { type: "object", properties },
  };
}

const SYSTEM_PROMPT = `You estimate the micronutrient content of foods for a nutrition app.

Given a food name, estimate its typical content per 100 g of the ten tracked nutrients, each in the exact unit named in the tool schema (grams for fiber, milligrams for minerals and vitamin C, micrograms for vitamins D and B12).

Rules:
- Estimate from well-known food-composition norms (think USDA FoodData Central averages for a generic version of the food).
- Use the food's most common preparation if unspecified (e.g. "chicken breast" = cooked, skinless).
- Omit a nutrient entirely when you genuinely cannot estimate it — never pad with 0 or a guess you have no basis for.
- These are approximations for a generic food, not a specific product. Do not over-precision; round sensibly.`;

/** Estimate per-100g micronutrients for a food by name, via Claude.
 *
 *  The OFF-miss fallback in the enrichment cron: when Open Food Facts
 *  has no usable match for a name, this gives an approximate profile so
 *  the food still contributes to the report (flagged `source: "ai"` so
 *  a medical reader knows it's a model estimate, not product data).
 *
 *  Returns the parsed per-100g values (canonical units), dropping any
 *  non-finite or out-of-range entries. Returns `{}` on any failure —
 *  the caller treats that as a miss. Never throws: enrichment is
 *  best-effort and must not wedge the cron. */
export async function estimateMicronutrientsAI(
  foodName: string,
  apiKey: string,
): Promise<MicronutrientValues> {
  const name = foodName.trim();
  if (!name) return {};
  try {
    const anthropic = new Anthropic({ apiKey });
    const tool = buildTool();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: `Estimate the per-100g micronutrients for: ${name}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return {};
    return sanitizeEstimate(block.input);
  } catch {
    return {};
  }
}

/** Validate the model's tool input into a `MicronutrientValues`. Keeps
 *  only finite, non-negative numbers for known keys, and caps each at a
 *  generous sanity ceiling (10× the Daily Value) so a hallucinated
 *  outlier can't poison the aggregate. Exported for unit testing. */
export function sanitizeEstimate(input: unknown): MicronutrientValues {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const out: MicronutrientValues = {};
  for (const key of MICRONUTRIENT_KEYS as MicronutrientKey[]) {
    const v = record[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      // Reject absurd values (a hallucinated "iron: 9000 mg"): cap at
      // 10× the DV. A real food rarely exceeds a few× the DV per 100 g.
      const ceiling = MICRONUTRIENTS[key].dv * 10;
      if (v <= ceiling) out[key] = v;
    }
  }
  return out;
}
