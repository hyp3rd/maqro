import { getAnthropicConfig } from "@/lib/ai/env";
import { parseBody } from "@/lib/api/parse-body";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { checkAndIncrementAiUsage } from "@/lib/billing/usage";
import {
  SHOPPING_AISLES,
  type ShoppingAisle,
  categorizeFallback,
} from "@/lib/shopping/categorize";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

// Haiku 4.5 — deduping a short list and assigning aisles is an easy,
// single-turn task; the cheaper model is plenty and keeps this well
// under the monthly AI budget.
const MODEL: Anthropic.Model = "claude-haiku-4-5";
export const maxDuration = 30;
const MAX_TOKENS = 1500;
const MAX_ITEMS = 60;

const BodySchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: z.number().finite().nonnegative(),
        unit: z.string().max(40),
      }),
    )
    .max(MAX_ITEMS),
  /** Optional extra context: names of foods in the user's upcoming meal
   *  plan, so the model can suggest things they'll need but aren't yet
   *  tracking as low. */
  plannedFoods: z.array(z.string().min(1).max(200)).max(MAX_ITEMS).optional(),
});

/** One line on the generated shopping list. */
export type ShoppingSuggestionItem = {
  name: string;
  quantity: number;
  unit: string;
  category: ShoppingAisle;
};

export type ShoppingSuggestion = {
  items: ShoppingSuggestionItem[];
  /** Whether the AI produced this, or the deterministic fallback did
   *  (AI unconfigured, over the monthly cap, or the call failed). The
   *  client surfaces a subtle "offline list" hint when false. */
  ai: boolean;
};

type AiItem = {
  name?: unknown;
  quantity?: unknown;
  unit?: unknown;
  category?: unknown;
};

/** Turn a restock + planned-foods request into a clean, deduplicated,
 *  aisle-categorized shopping list. AI-assisted when configured and
 *  within the monthly cap; otherwise a deterministic fallback so the
 *  feature still works for guests, offline, or once the cap is hit.
 *
 *  Auth-gated + AAL2-gated like the other authenticated routes (the
 *  `require-aal2-gate` lint rule enforces this). */
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

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Decide whether to spend an AI call: only when configured AND the
  // user is within their monthly cap. Over the cap (or unconfigured) we
  // fall back rather than 402, because the deterministic list is still
  // useful — the cap meters AI smarts, it doesn't lock the feature.
  const ai = getAnthropicConfig();
  let useAi = false;
  if (ai) {
    const usage = await checkAndIncrementAiUsage(supabase, user.id);
    useAi = usage.allowed;
  }

  if (useAi && ai) {
    try {
      const items = await generateWithAi(ai.apiKey, body);
      return NextResponse.json({
        items,
        ai: true,
      } satisfies ShoppingSuggestion);
    } catch {
      // Fall through to the deterministic list — never block the user
      // on an AI hiccup.
    }
  }

  return NextResponse.json({
    items: fallbackList(body),
    ai: false,
  } satisfies ShoppingSuggestion);
}

async function generateWithAi(
  apiKey: string,
  body: z.infer<typeof BodySchema>,
): Promise<ShoppingSuggestionItem[]> {
  const onHand = body.items
    .map((i) => `- ${i.name} (have ${i.quantity} ${i.unit})`)
    .join("\n");
  const planned = (body.plannedFoods ?? []).map((n) => `- ${n}`).join("\n");

  const systemPrompt = `You build a grocery shopping list. The user is low on or out of the items below; some upcoming meals may need more. Produce a clean list to buy.

Rules:
- Merge duplicates and near-duplicates into one line ("Brown rice" + "rice" → one).
- Suggest a sensible purchase quantity + unit, rounding UP to a typical retail package (e.g. don't ask for 40 g of rice — a 1 kg bag).
- Use the everyday, shoppable product name a person writes on a list — no brands, no recipe phrasing.
- Assign each item one store aisle from this exact set: ${SHOPPING_AISLES.join(", ")}.
- Don't invent items beyond what the inputs imply. A shorter accurate list beats a padded one.
- At most ${MAX_ITEMS} items.`;

  const userText = `Low / out of stock:\n${onHand || "(none)"}\n\nUpcoming meals may also need:\n${planned || "(none)"}\n\nReturn the shopping list via submit_shopping_list.`;

  const tool: Anthropic.Tool = {
    name: "submit_shopping_list",
    description:
      "Final output: the cleaned, deduplicated, aisle-categorized shopping list. Required.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: `Items to buy. Up to ${MAX_ITEMS}.`,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Everyday product name." },
              quantity: {
                type: "number",
                description: "Suggested purchase amount. > 0.",
              },
              unit: {
                type: "string",
                description:
                  "Unit for the quantity (e.g. 'kg', 'pack', 'unit').",
              },
              category: { type: "string", enum: [...SHOPPING_AISLES] },
            },
            required: ["name", "quantity", "unit", "category"],
          },
        },
      },
      required: ["items"],
    },
  };

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
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
    tool_choice: { type: "tool", name: "submit_shopping_list" },
    messages: [{ role: "user", content: userText }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "submit_shopping_list") {
    throw new Error("AI returned no shopping list.");
  }
  const raw = (toolUse.input as { items?: AiItem[] }).items;
  const rawItems = Array.isArray(raw) ? raw : [];
  const out: ShoppingSuggestionItem[] = [];
  for (const r of rawItems) {
    if (!r || typeof r.name !== "string") continue;
    const name = r.name.trim().slice(0, 200);
    if (!name) continue;
    out.push({
      name,
      quantity: cleanQuantity(r.quantity),
      unit:
        typeof r.unit === "string" && r.unit.trim() ? r.unit.trim() : "unit",
      category: cleanCategory(r.category),
    });
    if (out.length >= MAX_ITEMS) break;
  }
  // If the model returned nothing usable, treat as a failure so the
  // caller falls back rather than showing an empty list.
  if (out.length === 0) throw new Error("AI shopping list was empty.");
  return out;
}

/** Deterministic list: dedupe the inputs by normalized name, keep the
 *  user's quantities, append planned foods as quantity-1 entries, and
 *  assign aisles by keyword. */
function fallbackList(
  body: z.infer<typeof BodySchema>,
): ShoppingSuggestionItem[] {
  const byName = new Map<string, ShoppingSuggestionItem>();
  const add = (name: string, quantity: number, unit: string) => {
    const key = name.trim().toLowerCase();
    if (!key || byName.has(key)) return;
    byName.set(key, {
      name: name.trim(),
      quantity: cleanQuantity(quantity),
      unit: unit.trim() || "unit",
      category: categorizeFallback(name),
    });
  };
  for (const i of body.items) add(i.name, i.quantity || 1, i.unit);
  for (const n of body.plannedFoods ?? []) add(n, 1, "unit");
  return [...byName.values()].slice(0, MAX_ITEMS);
}

function cleanQuantity(q: unknown): number {
  if (typeof q !== "number" || !Number.isFinite(q) || q <= 0) return 1;
  return Math.min(q, 9999);
}

function cleanCategory(c: unknown): ShoppingAisle {
  return (SHOPPING_AISLES as readonly string[]).includes(c as string)
    ? (c as ShoppingAisle)
    : "Other";
}
