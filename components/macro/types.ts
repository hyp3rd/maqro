/** Re-export shim — the domain types + constants moved to `@maqro/core`. Kept
 *  so the existing `@/components/macro/types` imports (90+ call sites) keep
 *  working unchanged. Import from `@maqro/core` directly in new code. */
export * from "@maqro/core/types";
