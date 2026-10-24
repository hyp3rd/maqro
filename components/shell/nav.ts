import { TodayRings } from "@/components/icons/TodayRings";
import {
  Apple,
  Calculator,
  ChefHat,
  HeartPulse,
  LayoutGrid,
  LineChart,
  type LucideIcon,
  Package,
  Settings,
  ShoppingCart,
  UserRound,
} from "lucide-react";

/** The single navigation registry. Every destination of the app is declared
 *  here once; the desktop Sidebar, the mobile tab bar and its More sheet, the
 *  You hub, the CommandPalette, the Topbar title and the `?view=` parser all
 *  read from it, so they can no longer drift apart.
 *
 *  The keys are the stable `?view=` values: links in emails, bookmarks, the
 *  Stripe portal's return URL and every `setView` call use them, so a key is
 *  never renamed (the day view stays `plan` even though it reads "Today"). */
export type ViewKey =
  | "plan"
  | "progress"
  | "foods"
  | "recipes"
  | "templates"
  | "shopping"
  | "pantry"
  | "profile"
  | "calculator"
  | "health"
  | "settings";

/** Desktop sidebar section. "you" holds exactly what the phone's You tab
 *  holds (the tab's own view and its hub tiles), so the two places named
 *  "You" list the same things; "other" is the rest of the phone's More
 *  sheet (Health & fasting, Settings), unlabelled. */
export type NavGroup = "main" | "library" | "kitchen" | "you" | "other";

/** Where the destination lives on a phone: its own tab, the More sheet, or
 *  a tile in the You hub (the Profile view), which shows `hint` under it. */
type MobileHome =
  { mobile: "tab" } | { mobile: "more" } | { mobile: "you"; hint: string };

export type NavDestination = MobileHome & {
  /** Sidebar, More sheet, You hub and command palette name. */
  label: string;
  /** Tab bar label (12px under the icon, so one short word). */
  shortLabel: string;
  /** Topbar heading while the view is open. */
  title: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Extra words the command palette matches, so "weight" finds Progress. */
  keywords: readonly string[];
};

/** Declaration order is display order: the sidebar, the More sheet and the
 *  You hub list destinations in the order they appear here. `satisfies`
 *  makes the registry exhaustive: a `ViewKey` without an entry (or an entry
 *  for a key that isn't one) fails the type check. */
export const NAV = {
  plan: {
    label: "Today",
    shortLabel: "Today",
    title: "Today",
    icon: TodayRings,
    group: "main",
    mobile: "tab",
    keywords: [
      "meal plan",
      "meals",
      "log",
      "diary",
      "breakfast",
      "lunch",
      "dinner",
    ],
  },
  progress: {
    label: "Progress",
    shortLabel: "Progress",
    title: "Progress",
    icon: LineChart,
    group: "main",
    mobile: "tab",
    keywords: ["weight", "graph", "trend", "plateau", "streak"],
  },
  foods: {
    label: "Foods",
    shortLabel: "Foods",
    title: "My foods",
    icon: Apple,
    group: "library",
    mobile: "more",
    keywords: ["my foods", "catalog", "custom", "ingredients"],
  },
  recipes: {
    label: "Recipes",
    shortLabel: "Recipes",
    title: "Recipes",
    icon: ChefHat,
    group: "library",
    mobile: "more",
    keywords: ["cookbook", "ingredients"],
  },
  templates: {
    label: "Templates",
    shortLabel: "Templates",
    title: "Meal templates",
    icon: LayoutGrid,
    group: "library",
    mobile: "more",
    keywords: ["saved meals", "presets"],
  },
  shopping: {
    label: "Shopping",
    shortLabel: "Shopping",
    title: "Shopping list",
    icon: ShoppingCart,
    group: "kitchen",
    mobile: "more",
    keywords: ["grocery", "list", "buy"],
  },
  pantry: {
    label: "Pantry",
    shortLabel: "Pantry",
    title: "Pantry",
    icon: Package,
    group: "kitchen",
    mobile: "more",
    keywords: ["inventory", "stock", "fridge", "on hand", "have"],
  },
  profile: {
    label: "Profile",
    shortLabel: "You",
    // The screen the You tab opens is headed as the tab reads.
    title: "You",
    icon: UserRound,
    group: "you",
    mobile: "tab",
    keywords: ["you", "body", "age", "birthdate", "weight", "height", "me"],
  },
  calculator: {
    label: "Targets",
    shortLabel: "Targets",
    title: "Targets",
    // Not a target/rings glyph: that would sit beside Today's rings as a
    // near-twin in the sidebar. The calculator is what this view is.
    icon: Calculator,
    group: "you",
    mobile: "you",
    hint: "Calories, macros & goal",
    keywords: ["calculator", "macros", "tdee", "bmr", "goal", "phases"],
  },
  health: {
    label: "Health & fasting",
    shortLabel: "Health",
    title: "Health & fasting",
    icon: HeartPulse,
    group: "other",
    mobile: "more",
    keywords: [
      "fasting",
      "intermittent",
      "if",
      "16:8",
      "phase",
      "autophagy",
      "ketosis",
      "eating window",
      "supplement",
      "supplements",
      "vitamin",
    ],
  },
  settings: {
    label: "Settings",
    shortLabel: "Settings",
    title: "Settings",
    icon: Settings,
    group: "other",
    mobile: "more",
    keywords: [
      "account",
      "billing",
      "subscription",
      "notifications",
      "export",
      "import",
      "delete",
    ],
  },
} as const satisfies Record<ViewKey, NavDestination>;

/** Every key, in display order. `Object.keys` is typed `string[]`; the
 *  `satisfies` above guarantees the keys are exactly `ViewKey`. */
export const VIEW_KEYS = Object.keys(NAV) as readonly ViewKey[];

/** One cell of the mobile tab bar: a destination, the centre quick add, or
 *  the More sheet. */
export type TabSlot = ViewKey | "quickAdd" | "more";

/** The mobile tab bar, left to right. INTERIM until the Pro Suggestions
 *  section exists: that change replaces `"more"` here with its own tab, and
 *  the More sheet then moves into the You hub on its own (see
 *  `MORE_IN_TAB_BAR`). Typed as a plain array, not a tuple, so dropping
 *  `"more"` keeps every `includes` check compiling. */
export const TAB_BAR: readonly TabSlot[] = [
  "plan",
  "progress",
  "quickAdd",
  "more",
  "profile",
];

/** The tab that hosts the You hub. */
export const YOU_TAB: ViewKey = "profile";

/** Whether the More sheet has its own tab; when not, the You hub offers it. */
export const MORE_IN_TAB_BAR = TAB_BAR.includes("more");

/** The day view — where no (or an unknown) `?view=` lands. */
export const DEFAULT_VIEW: ViewKey = "plan";

/** Destinations listed in the mobile More sheet, in display order. */
export const MORE_SHEET: readonly ViewKey[] = VIEW_KEYS.filter(
  (k) => NAV[k].mobile === "more",
);

/** Destinations shown as tiles in the You hub, in display order, each with
 *  the hint its tile shows. */
export const YOU_HUB: readonly { key: ViewKey; hint: string }[] =
  VIEW_KEYS.flatMap((key) => {
    const d: NavDestination = NAV[key];
    return d.mobile === "you" ? [{ key, hint: d.hint }] : [];
  });

const GROUP_LABELS: Record<NavGroup, string | null> = {
  main: null,
  library: "Library",
  kitchen: "Kitchen",
  you: "You",
  other: null,
};

/** The desktop sidebar's sections, in order, each listing its destinations
 *  in registry order. `label` is null for an unlabelled section (the first,
 *  and the last). */
export const SIDEBAR_GROUPS: readonly {
  id: NavGroup;
  label: string | null;
  items: readonly ViewKey[];
}[] = (Object.keys(GROUP_LABELS) as NavGroup[]).map((id) => ({
  id,
  label: GROUP_LABELS[id],
  items: VIEW_KEYS.filter((k) => NAV[k].group === id),
}));

/** Old `?view=` values that still land somewhere: the day view is "Today"
 *  now, and the fasting page became the Health page. A Map, not an object
 *  literal, so prototype names ("constructor") are not aliases. */
const VIEW_ALIASES: ReadonlyMap<string, ViewKey> = new Map([
  ["today", "plan"],
  ["fasting", "health"],
]);

function isViewKey(raw: string): raw is ViewKey {
  return Object.hasOwn(NAV, raw);
}

/** The view a `?view=` value opens: a registered key opens itself, an alias
 *  its target, and anything else (missing, typo, removed view, hostile
 *  input) the day view. */
export function viewFromParam(raw: string | null): ViewKey {
  if (raw === null) return DEFAULT_VIEW;
  if (isViewKey(raw)) return raw;
  return VIEW_ALIASES.get(raw) ?? DEFAULT_VIEW;
}

/** Where copy sends someone for `key`, in the names they will see: the
 *  destination's label, plus the way to it on a phone when the tab bar
 *  doesn't show it under that label ("Targets (You → Targets on a phone)").
 *  Copy reads this rather than naming a place itself, so it follows the
 *  registry when a destination is renamed or moves. */
export function navPlace(key: ViewKey): string {
  const d: NavDestination = NAV[key];
  switch (d.mobile) {
    case "tab":
      return d.shortLabel === d.label
        ? d.label
        : `${d.label} (${d.shortLabel} on a phone)`;
    case "you":
      return `${d.label} (${NAV[YOU_TAB].shortLabel} → ${d.label} on a phone)`;
    case "more":
      // The More sheet lists it under its label, wherever the sheet lives.
      return d.label;
  }
}

/** The tab bar slot that lights up for `current`: its own tab, else the
 *  slot that hosts it on a phone (More, or the You tab for hub tiles and,
 *  once More leaves the tab bar, for the More sheet's destinations too). */
export function activeTabSlot(current: ViewKey): TabSlot {
  if (TAB_BAR.includes(current)) return current;
  const d: NavDestination = NAV[current];
  if (d.mobile === "more" && MORE_IN_TAB_BAR) return "more";
  return YOU_TAB;
}
