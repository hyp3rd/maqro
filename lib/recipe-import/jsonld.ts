import { decodeHtmlEntities, formatIsoDuration } from "./text-utils";

/** Parse schema.org Recipe JSON-LD out of an HTML document. This is
 *  the de-facto interchange format every recipe site uses for
 *  Google's recipe rich-snippets — NYT Cooking, Serious Eats,
 *  Bon Appétit, AllRecipes, Smitten Kitchen all embed it. Sites
 *  that don't will simply yield `null` here; the caller is
 *  expected to surface a "no recipe found" message rather than
 *  attempting heuristic scraping.
 *
 *  We hand-roll the extraction instead of pulling in a microdata
 *  parser dep — the recipe shape is small and we only care about a
 *  few fields, so the cost of a transitive-dep on a 50 KB parser
 *  isn't justified.
 *
 *  Robustness notes (encoded from real-world recipe pages):
 *    - Some sites wrap the recipe in `@graph` rather than a top-
 *      level object; we walk that.
 *    - Some sites supply multiple `<script type="application/ld+json">`
 *      blocks (one for the recipe, one for the breadcrumb, one for
 *      the publisher) — we scan all of them.
 *    - Ingredients are usually strings but occasionally objects
 *      with `name` fields; we coerce both.
 *    - Instructions are sometimes a single string with newlines,
 *      sometimes an array of HowToStep objects; we coerce both. */

export type ParsedRecipe = {
  name: string;
  /** Raw human-readable ingredient strings ("2 cups flour", "1 tsp
   *  baking soda"). Caller is responsible for any structured
   *  matching against a food catalog. */
  ingredients: string[];
  /** Step strings. Order preserved. */
  instructions: string[];
  /** ISO 8601 duration if present ("PT45M"). Unparsed — leaving the
   *  unit conversion to the renderer or the caller. */
  totalTime?: string;
  /** Yields / servings as a human-readable string ("4 servings",
   *  "Makes 12"). Some sources stash a number here instead. */
  yieldText?: string;
  /** Stripe-case "cuisine" tag if present. */
  cuisine?: string;
};

/** Extract the recipe (if any) from the HTML document. Returns
 *  null when no JSON-LD Recipe block is found. */
export function parseRecipeJsonLd(html: string): ParsedRecipe | null {
  for (const block of extractJsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      // Malformed JSON in one block doesn't invalidate the page —
      // some publishers ship trailing commas etc. Skip to the next.
      continue;
    }
    const recipe = findRecipeNode(parsed);
    if (recipe) return toParsedRecipe(recipe);
  }
  return null;
}

/** Pull every `application/ld+json` script body out of the HTML.
 *  Non-greedy match on the closing tag so multiple blocks parse
 *  correctly. We don't fully tokenize HTML — JSON-LD lives in
 *  exactly this one shape across the web. */
function extractJsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const re =
    /<script\s+[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const body = match[1]?.trim();
    if (body) out.push(body);
  }
  return out;
}

/** Walk a parsed JSON-LD structure looking for a node whose
 *  `@type` is "Recipe" (or includes "Recipe" when @type is an
 *  array). Handles the common `@graph` wrapper.
 *
 *  Returns the recipe object, or null. */
function findRecipeNode(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string" && t === "Recipe") return obj;
  if (Array.isArray(t) && t.some((x) => x === "Recipe")) return obj;
  // Some pages wrap everything in a @graph array.
  const graph = obj["@graph"];
  if (graph) return findRecipeNode(graph);
  return null;
}

function toParsedRecipe(node: Record<string, unknown>): ParsedRecipe {
  return {
    name: coerceString(node.name) ?? "Untitled recipe",
    ingredients: coerceIngredients(node.recipeIngredient),
    instructions: coerceInstructions(node.recipeInstructions),
    // totalTime is canonically an ISO 8601 duration in schema.org
    // (e.g. PT45M). Humanize it so the UI never displays the raw
    // ISO form, which a non-technical user reads as gibberish.
    totalTime: formatIsoDuration(coerceString(node.totalTime)),
    yieldText: coerceString(node.recipeYield),
    cuisine: coerceString(node.recipeCuisine),
  };
}

/** Pull a string out of an unknown JSON value AND decode HTML
 *  entities. Publishers routinely auto-generate JSON-LD from
 *  HTML-encoded article text without re-encoding, so values like
 *  `Tomato purée &frac34; cup` come through with literal entity
 *  references. Decoding here means every downstream consumer
 *  (preview, notes, AI extraction prompt) sees clean unicode. */
function coerceString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const trimmed = decodeHtmlEntities(v).trim();
    return trimmed || undefined;
  }
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    const first = v.find((x) => typeof x === "string");
    return typeof first === "string"
      ? decodeHtmlEntities(first).trim() || undefined
      : undefined;
  }
  return undefined;
}

function coerceIngredients(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const t = decodeHtmlEntities(item).trim();
      if (t) out.push(t);
    } else if (item && typeof item === "object") {
      // Some publishers emit ingredient objects with a `name` field.
      const name = coerceString((item as Record<string, unknown>).name);
      if (name) out.push(name);
    }
  }
  return out;
}

function coerceInstructions(v: unknown): string[] {
  if (typeof v === "string") {
    // Single-string form: split on newlines, drop empties.
    return decodeHtmlEntities(v)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const t = decodeHtmlEntities(item).trim();
      if (t) out.push(t);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const inner = obj.itemListElement;
      if (Array.isArray(inner)) {
        // HowToSection container — the section's `name` is a heading,
        // not a step. Only walk its children.
        for (const step of coerceInstructions(inner)) out.push(step);
      } else {
        // HowToStep: { @type: "HowToStep", text: "Mix the …" }
        const text = coerceString(obj.text) ?? coerceString(obj.name);
        if (text) out.push(text);
      }
    }
  }
  return out;
}
