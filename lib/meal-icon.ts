import {
  Cookie,
  Croissant,
  Sandwich,
  Utensils,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/** Pick a per-meal icon from the slot name so meal tiles scan at a
 *  glance. Matches by substring (case-insensitive) so renamed slots
 *  like "Pre-workout snack" still resolve; anything unrecognized —
 *  including fully custom slots — falls back to a generic cutlery
 *  glyph. */
export function mealIcon(name: string): LucideIcon {
  const n = name.trim().toLowerCase();
  if (n.includes("breakfast") || n.includes("brunch")) return Croissant;
  if (n.includes("lunch")) return Sandwich;
  if (n.includes("dinner") || n.includes("supper")) return UtensilsCrossed;
  if (n.includes("snack")) return Cookie;
  return Utensils;
}
