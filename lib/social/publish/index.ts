import { getSocialConfig } from "@/lib/social/env";
import type { PublishablePost, PublishResult } from "@/lib/social/types";
import { publishInstagram } from "./instagram";
import { publishLinkedIn } from "./linkedin";
import { publishX } from "./x";

export type DispatchResult = PublishResult & { configured: boolean };

/** Publish a post to its platform when that platform is configured. When it
 *  isn't, returns `configured: false` so the caller can fall back to the manual
 *  "mark posted" path instead of recording a failure. */
export async function publishPost(
  post: PublishablePost,
): Promise<DispatchResult> {
  const config = getSocialConfig();
  switch (post.platform) {
    case "linkedin":
      if (!config.linkedin) {
        return {
          ok: false,
          error: "LinkedIn not configured.",
          configured: false,
        };
      }
      return {
        ...(await publishLinkedIn(post, config.linkedin)),
        configured: true,
      };
    case "x":
      if (!config.x) {
        return { ok: false, error: "X not configured.", configured: false };
      }
      return { ...(await publishX(post, config.x)), configured: true };
    case "instagram":
      if (!config.instagram) {
        return {
          ok: false,
          error: "Instagram not configured.",
          configured: false,
        };
      }
      return {
        ...(await publishInstagram(post, config.instagram)),
        configured: true,
      };
  }
}
