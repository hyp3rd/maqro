import type { LinkedInConfig } from "@/lib/social/env";
import type { PublishablePost, PublishResult } from "@/lib/social/types";

// LinkedIn versions the API by YYYYMM and sunsets old ones; bump this as needed.
// Verified against the Posts API docs (li-lms-2026-05).
const LINKEDIN_VERSION = "202605";

/** Escape LinkedIn "little text format" reserved characters so prose renders
 *  literally. Without this, a stray "(" or "#" in the copy is parsed as
 *  annotation/markup syntax and the post is rejected or rendered wrong. This is
 *  the most likely thing to need tuning against a real post. */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\<>@[\]()|{}#*_~]/g, (c) => `\\${c}`);
}

/** Create an organization text post via the Posts API. The post id comes back in
 *  the `x-restli-id` response header, not the body. */
export async function publishLinkedIn(
  post: PublishablePost,
  config: LinkedInConfig,
): Promise<PublishResult> {
  try {
    const res = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        author: config.orgUrn,
        commentary: escapeLittleText(post.body),
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        error: `LinkedIn ${res.status}: ${detail.slice(0, 300)}`,
      };
    }
    const id = res.headers.get("x-restli-id") ?? "";
    return {
      ok: true,
      id,
      url: id ? `https://www.linkedin.com/feed/update/${id}/` : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "LinkedIn request failed.",
    };
  }
}
