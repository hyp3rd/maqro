/** Re-export shim — the macro engine (`computeMacros`,
 *  `aggregateMacroBreakdown`) moved to `@maqro/core`. Kept so the existing
 *  `@/lib/macros` imports keep working unchanged. Import from `@maqro/core`
 *  directly in new code. */
export * from "@maqro/core/macros";
