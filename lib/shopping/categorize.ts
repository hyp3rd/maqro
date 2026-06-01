/** Store aisles a shopping item can fall under. Shared between the AI
 *  `submit_shopping_list` tool enum and the deterministic fallback, so
 *  the client can group by the same set regardless of which produced the
 *  list. Ordered roughly the way you'd walk a store. */
export const SHOPPING_AISLES = [
  "Produce",
  "Dairy & Eggs",
  "Meat & Seafood",
  "Bakery",
  "Pantry & Dry Goods",
  "Frozen",
  "Beverages",
  "Household",
  "Other",
] as const;

export type ShoppingAisle = (typeof SHOPPING_AISLES)[number];

/** Keyword → aisle hints for the deterministic fallback. First aisle
 *  with a matching whole-word-ish substring wins; order matters only for
 *  overlaps (checked in `SHOPPING_AISLES` order). Deliberately small and
 *  obvious — the AI route does the nuanced grouping; this just keeps the
 *  no-AI / offline path sensible. */
const AISLE_KEYWORDS: Partial<Record<ShoppingAisle, string[]>> = {
  Produce: [
    "lettuce",
    "spinach",
    "kale",
    "tomato",
    "onion",
    "garlic",
    "potato",
    "carrot",
    "pepper",
    "broccoli",
    "cucumber",
    "apple",
    "banana",
    "berry",
    "berries",
    "lemon",
    "lime",
    "orange",
    "avocado",
    "mushroom",
    "celery",
    "fruit",
    "vegetable",
    "salad",
    "herb",
    "ginger",
  ],
  "Dairy & Eggs": [
    "milk",
    "cheese",
    "yogurt",
    "yoghurt",
    "butter",
    "cream",
    "egg",
    "kefir",
    "ricotta",
    "mozzarella",
    "parmesan",
  ],
  "Meat & Seafood": [
    "chicken",
    "beef",
    "pork",
    "turkey",
    "lamb",
    "bacon",
    "sausage",
    "steak",
    "mince",
    "salmon",
    "tuna",
    "fish",
    "shrimp",
    "prawn",
    "cod",
    "ham",
  ],
  Bakery: ["bread", "bagel", "tortilla", "roll", "bun", "pita", "croissant"],
  "Pantry & Dry Goods": [
    "rice",
    "pasta",
    "flour",
    "sugar",
    "oat",
    "oats",
    "cereal",
    "bean",
    "lentil",
    "chickpea",
    "quinoa",
    "oil",
    "vinegar",
    "sauce",
    "spice",
    "salt",
    "pepper",
    "stock",
    "broth",
    "honey",
    "peanut butter",
    "jam",
    "noodle",
    "couscous",
    "can",
    "tin",
    "protein powder",
    "powder",
  ],
  Frozen: ["frozen", "ice cream", "ice-cream"],
  Beverages: [
    "water",
    "juice",
    "soda",
    "coffee",
    "tea",
    "wine",
    "beer",
    "drink",
    "kombucha",
    "cola",
  ],
  Household: [
    "detergent",
    "soap",
    "shampoo",
    "toothpaste",
    "paper towel",
    "toilet",
    "cleaner",
    "foil",
    "wrap",
    "bag",
    "battery",
    "sponge",
  ],
};

/** Assign an aisle to an item name with no AI. Lowercase substring match
 *  against the keyword hints, in store-walk order; "Other" when nothing
 *  matches. */
export function categorizeFallback(name: string): ShoppingAisle {
  const n = name.toLowerCase();
  for (const aisle of SHOPPING_AISLES) {
    const keywords = AISLE_KEYWORDS[aisle];
    if (keywords?.some((kw) => n.includes(kw))) return aisle;
  }
  return "Other";
}

/** Tally a list of aisles into per-aisle counts. Every aisle is present
 *  in the result (0 when none). Used by callers that already know each
 *  item's (possibly user-overridden) aisle. */
export function tallyAisles(
  aisles: ShoppingAisle[],
): Record<ShoppingAisle, number> {
  const counts = Object.fromEntries(
    SHOPPING_AISLES.map((a) => [a, 0]),
  ) as Record<ShoppingAisle, number>;
  for (const aisle of aisles) counts[aisle]++;
  return counts;
}

/** Tally how many of `names` fall into each aisle (via
 *  `categorizeFallback`). Convenience over `tallyAisles` for the
 *  name-only case. */
export function categoryCounts(names: string[]): Record<ShoppingAisle, number> {
  return tallyAisles(names.map(categorizeFallback));
}

/** Per-aisle color tokens. Mirrors the existing low-stock /
 *  macro-color conventions in the app: a 10%-opacity background
 *  tint, a 700/dark-mode-400 text shade, and a matching 600/400
 *  icon. Kept here (not buried in a component) so the same palette
 *  is reused by the shopping list section headers, the pantry
 *  per-item aisle badges, and the pantry filter chips — so the
 *  same Produce green reads "Produce" everywhere the user sees
 *  the aisle, on any surface. */
export type AisleColor = {
  /** Tinted background, low-opacity so it sits as a wash rather
   *  than competing with the row content. */
  bg: string;
  /** Foreground color for the aisle name. Strong enough to read as
   *  a label, not so strong that it shouts. */
  text: string;
  /** Icon tint — half a notch lighter than `text` so the icon reads
   *  as a glyph and not a duplicate of the label. */
  icon: string;
  /** Border accent — used on the Pantry filter chips to make the
   *  active aisle visibly "owned" by its color. */
  border: string;
};

export const AISLE_COLORS: Record<ShoppingAisle, AisleColor> = {
  Produce: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-400",
    icon: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/40",
  },
  "Dairy & Eggs": {
    bg: "bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/40",
  },
  "Meat & Seafood": {
    bg: "bg-rose-500/10",
    text: "text-rose-700 dark:text-rose-400",
    icon: "text-rose-600 dark:text-rose-400",
    border: "border-rose-500/40",
  },
  Bakery: {
    bg: "bg-orange-500/10",
    text: "text-orange-700 dark:text-orange-400",
    icon: "text-orange-600 dark:text-orange-400",
    border: "border-orange-500/40",
  },
  "Pantry & Dry Goods": {
    bg: "bg-yellow-500/10",
    text: "text-yellow-700 dark:text-yellow-400",
    icon: "text-yellow-600 dark:text-yellow-400",
    border: "border-yellow-500/40",
  },
  Frozen: {
    bg: "bg-sky-500/10",
    text: "text-sky-700 dark:text-sky-400",
    icon: "text-sky-600 dark:text-sky-400",
    border: "border-sky-500/40",
  },
  Beverages: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-700 dark:text-cyan-400",
    icon: "text-cyan-600 dark:text-cyan-400",
    border: "border-cyan-500/40",
  },
  Household: {
    bg: "bg-purple-500/10",
    text: "text-purple-700 dark:text-purple-400",
    icon: "text-purple-600 dark:text-purple-400",
    border: "border-purple-500/40",
  },
  Other: {
    bg: "bg-muted/40",
    text: "text-muted-foreground",
    icon: "text-muted-foreground",
    border: "border-muted-foreground/40",
  },
};
