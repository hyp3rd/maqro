/** Re-export shim — the RDA / micronutrient reference tables moved to
 *  `@maqro/core`. Kept so the existing `@/lib/rda` imports across the app keep
 *  working unchanged. Import from `@maqro/core` directly in new code. */
export * from "@maqro/core/rda";
