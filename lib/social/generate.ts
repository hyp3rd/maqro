import { getAnthropicConfig } from "@/lib/ai/env";
import type { ChangelogEntry } from "@/lib/changelog";
import { lintTone } from "@/lib/social/tone";
import { PLATFORM_MAX_CHARS, type GeneratedPost } from "@/lib/social/types";
import Anthropic from "@anthropic-ai/sdk";

const MODEL: Anthropic.Model = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;

/** One sentence of grounding so the copy doesn't drift into generic SaaS hype. */
const BRAND =
  "Maqro is a private, offline-first macro and nutrition tracker: log meals, plan recipes, and track weight and health, with optional AI help.";

export type GenerateResult =
  { ok: true; posts: GeneratedPost[] } | { ok: false; error: string };

/** Draft one X / LinkedIn / Instagram post from a changelog entry. The voice
 *  rules are in the prompt for guidance, but the deterministic `lintTone` pass
 *  is what actually enforces them, so the stored draft is always clean. */
export async function generateCampaignDrafts(
  entry: ChangelogEntry,
): Promise<GenerateResult> {
  const ai = getAnthropicConfig();
  if (!ai) return { ok: false, error: "ANTHROPIC_API_KEY not configured." };

  const systemPrompt = `You are the release-notes copywriter for Maqro, drafting social posts a human will review before publishing.

${BRAND}

Write one post for each of X, LinkedIn, and Instagram announcing the release below. Ground every claim in the release notes. Do not invent features.

Voice (hard rules):
- Professional, plain, concise. Write like a careful engineer, not a marketer.
- No emoji. No exclamation marks. No em dashes or en dashes; use commas and periods.
- No marketing cliches or AI tells (no "thrilled", "excited to announce", "seamless", "game-changer", "elevate", "unleash", "supercharge", "revolutionize", "leverage", "empower", "the future of").
- No filler lists where a sentence works. No hype. State what changed and why it helps.

Per platform:
- x: at most 280 characters. One or two sentences. Lead with the concrete change.
- linkedin: two to four short paragraphs. State what shipped and the value to the user, in a professional register.
- instagram: a one to three line caption. The release image already carries the headline, so add context rather than repeating the title. At most two relevant hashtags, or none.

Call submit_posts exactly once.

Release:
Title: ${entry.title}${entry.version ? `\nVersion: ${entry.version}` : ""}
Notes:
${entry.body}`;

  const anthropic = new Anthropic({ apiKey: ai.apiKey });
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: "submit_posts",
          description: "Submit the three drafted posts. Call exactly once.",
          input_schema: {
            type: "object",
            properties: {
              x: { type: "string", description: "The X post, 280 chars max." },
              linkedin: { type: "string", description: "The LinkedIn post." },
              instagram: {
                type: "string",
                description: "The Instagram caption.",
              },
            },
            required: ["x", "linkedin", "instagram"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_posts" },
      messages: [
        { role: "user", content: "Draft the three posts. Call submit_posts." },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI request failed.",
    };
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "submit_posts",
  );
  if (!toolUse) return { ok: false, error: "The model did not return posts." };
  const input = toolUse.input as {
    x?: unknown;
    linkedin?: unknown;
    instagram?: unknown;
  };

  const posts: GeneratedPost[] = [];
  for (const platform of ["x", "linkedin", "instagram"] as const) {
    const raw = input[platform];
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    // Auto-fix the mechanical tells now; the dashboard re-runs lintTone on the
    // stored body to surface the judgement-call flags for the reviewer.
    const { text } = lintTone(raw, { maxLength: PLATFORM_MAX_CHARS[platform] });
    posts.push({ platform, body: text });
  }
  if (posts.length === 0) {
    return { ok: false, error: "The model returned empty posts." };
  }
  return { ok: true, posts };
}
