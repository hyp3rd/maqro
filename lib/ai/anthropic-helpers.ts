import type Anthropic from "@anthropic-ai/sdk";

/** Mark the last content block of a user message with ephemeral cache_control
 * so the API caches the prefix up to and including that block. Idempotent:
 * if the block is already marked, leaves it alone. Used to extend caching
 * across the agent loop's growing transcript — Anthropic keeps the most
 * recent 4 breakpoints automatically, so we never need to clear old ones.
 *
 * Shared by /api/meal-plan and /api/recipes/generate; both have the same
 * multi-turn growth pattern and benefit from the same cache breakpoints. */
export function markLastBlockForCache(msg: Anthropic.MessageParam): void {
  if (msg.role !== "user") return;
  if (typeof msg.content === "string" || msg.content.length === 0) return;
  const last = msg.content[msg.content.length - 1];
  if (
    last.type === "text" ||
    last.type === "image" ||
    last.type === "tool_result" ||
    last.type === "document"
  ) {
    last.cache_control = { type: "ephemeral" };
  }
}
