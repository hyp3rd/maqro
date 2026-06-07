import { getSocialConfig } from "@/lib/social/env";
import { getValidLinkedInAuth } from "@/lib/social/linkedin-auth";
import type { PublishablePost, PublishResult } from "@/lib/social/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishInstagram } from "./instagram";
import { publishLinkedIn } from "./linkedin";
import { publishX } from "./x";

export type DispatchResult = PublishResult & { configured: boolean };

/** Publish a post to its platform when that platform is configured. When it
 *  isn't, returns `configured: false` so the caller can fall back to the manual
 *  "mark posted" path instead of recording a failure. LinkedIn resolves a valid
 *  (auto-refreshed) token from storage via `admin`; X / Instagram read env. */
export async function publishPost(
  post: PublishablePost,
  admin: SupabaseClient,
): Promise<DispatchResult> {
  switch (post.platform) {
    case "linkedin": {
      const auth = await getValidLinkedInAuth(admin);
      if (!auth) {
        return {
          ok: false,
          error: "LinkedIn isn't connected.",
          configured: false,
        };
      }
      return { ...(await publishLinkedIn(post, auth)), configured: true };
    }
    case "x": {
      const x = getSocialConfig().x;
      if (!x)
        return { ok: false, error: "X not configured.", configured: false };
      return { ...(await publishX(post, x)), configured: true };
    }
    case "instagram": {
      const ig = getSocialConfig().instagram;
      if (!ig) {
        return {
          ok: false,
          error: "Instagram not configured.",
          configured: false,
        };
      }
      return { ...(await publishInstagram(post, ig)), configured: true };
    }
  }
}
