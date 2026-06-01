import { getAnthropicConfig } from "@/lib/ai/env";
import Anthropic from "@anthropic-ai/sdk";
import { htmlToReadableText } from "./html-to-text";
import type { ParsedRecipe } from "./jsonld";

/** AI-driven recipe extraction. Sent the page's text (stripped of
 *  HTML markup) and asked to return a structured recipe via the
 *  `extract_recipe` tool. This is the path the user opts into when
 *  ticking "Parse with AI" in the import dialog — useful for:
 *    - sites without JSON-LD (personal blogs, photo-heavy editorial
 *      pages, anything that didn't bother with schema.org markup)
 *    - JSON-LD payloads that omit prep notes / tips / variations
 *      that live in the surrounding article body
 *
 *  Model choice: Claude Haiku 4.5 — same model as our other
 *  recipe-touching surfaces. Cheap, fast, plenty smart enough for
 *  one-shot structured extraction from a chunk of text. We pass
 *  the page text via a single user message rather than running an
 *  agent loop because there's no tool the model needs to discover
 *  facts with — everything's in the input.
 *
 *  Returns `null` on any failure (tool not called, malformed
 *  payload, transport error). The caller decides whether to fall
 *  through to JSON-LD or surface a "couldn't extract" message. */

const MODEL: Anthropic.Model = "claude-haiku-4-5";
const MAX_TOKENS = 1500;

export type AiExtractResult = {
  recipe: ParsedRecipe & { prepNotes?: string };
} | null;

const TOOL: Anthropic.Tool = {
  name: "extract_recipe",
  description:
    "Submit the extracted recipe. Call this exactly once when you have all the fields you can extract. Skip fields that aren't present in the source.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The recipe's title as displayed on the page. Required.",
      },
      ingredients: {
        type: "array",
        items: { type: "string" },
        description:
          "Each ingredient as a single human-readable line, e.g. '2 cups all-purpose flour' or '1 tbsp olive oil, plus more for drizzling'. Preserve quantities and notes as written.",
      },
      instructions: {
        type: "array",
        items: { type: "string" },
        description:
          "Each preparation step as a single short paragraph. Drop step numbering — the order of the array IS the order. Combine consecutive sentences that describe one action.",
      },
      cuisine: {
        type: "string",
        description:
          "Cuisine tag if the page declares one ('Italian', 'Korean', 'Mediterranean'). Skip if not stated.",
      },
      yieldText: {
        type: "string",
        description:
          "Human-readable yield, e.g. '4 servings', 'Makes 12 cookies'. Skip if not stated.",
      },
      totalTime: {
        type: "string",
        description:
          "Total time as plain text, e.g. '45 minutes', '1 hour 30 minutes'. Skip if not stated.",
      },
      prepNotes: {
        type: "string",
        description:
          "Author's tips, substitutions, make-ahead notes, storage advice — anything the user would lose by only copying the ingredients and steps. Keep it tight: up to ~400 chars, paraphrase if needed.",
      },
    },
    required: ["name", "ingredients", "instructions"],
  },
};

const SYSTEM_PROMPT = `You extract structured recipes from web page text.

Rules:
- Always call extract_recipe once. Do not respond in prose.
- Pull ingredients verbatim — preserve quantities, units, and parenthetical notes.
- Combine multi-sentence preparation actions into single instruction entries; keep one logical step per array element.
- prepNotes is for the author's own tips, substitutions, storage advice, or "before you begin" notes that would otherwise be lost. If the page has none, omit the field rather than inventing content.
- Never invent content. If a field isn't in the source, omit it.`;

export async function extractRecipeWithAi(opts: {
  html: string;
  sourceUrl: string;
}): Promise<AiExtractResult> {
  const ai = getAnthropicConfig();
  if (!ai) return null;

  const text = htmlToReadableText(opts.html);
  if (text.length === 0) return null;

  const anthropic = new Anthropic({ apiKey: ai.apiKey });

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      // tool_choice forces the model to use our tool rather than
      // replying in prose. With Haiku this is the difference between
      // structured output we can trust and a JSON-shaped blob in a
      // text block that may or may not parse.
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Source URL: ${opts.sourceUrl}\n\nPage text:\n\n${text}`,
            },
          ],
        },
      ],
    });
  } catch {
    return null;
  }

  // Find the tool_use block. With tool_choice forcing the tool,
  // this should always be present, but defend against drift.
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === TOOL.name,
  );
  if (!block) return null;

  return coerceTool(block.input);
}

/** Defensive coercion of the model's tool input. Even with a
 *  schema-constrained tool, treat the output as untrusted —
 *  Anthropic enforces shape but not semantics, and a malformed
 *  payload here shouldn't blow up the route. */
function coerceTool(input: unknown): AiExtractResult {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  const name = typeof i.name === "string" ? i.name.trim() : "";
  if (!name) return null;
  const ingredients = Array.isArray(i.ingredients)
    ? i.ingredients.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      )
    : [];
  const instructions = Array.isArray(i.instructions)
    ? i.instructions.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      )
    : [];
  return {
    recipe: {
      name,
      ingredients,
      instructions,
      cuisine:
        typeof i.cuisine === "string" && i.cuisine.trim()
          ? i.cuisine.trim()
          : undefined,
      yieldText:
        typeof i.yieldText === "string" && i.yieldText.trim()
          ? i.yieldText.trim()
          : undefined,
      totalTime:
        typeof i.totalTime === "string" && i.totalTime.trim()
          ? i.totalTime.trim()
          : undefined,
      prepNotes:
        typeof i.prepNotes === "string" && i.prepNotes.trim()
          ? i.prepNotes.trim()
          : undefined,
    },
  };
}
