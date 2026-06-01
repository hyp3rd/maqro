/** Server-only Anthropic API key accessor. Returns `null` when the env
 * isn't set so the meal-plan route can respond with a clean 503 and the
 * client falls back to the deterministic planner. Never imported from a
 * `"use client"` module. */
export function getAnthropicConfig(): { apiKey: string } | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}
