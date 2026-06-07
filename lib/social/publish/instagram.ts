import type { InstagramConfig } from "@/lib/social/env";
import type { PublishablePost, PublishResult } from "@/lib/social/types";

const GRAPH = "https://graph.facebook.com/v21.0";

type GraphReply = { id?: string; error?: { message?: string } };

/** Two-step IG content publish: create a media container from the public image
 *  URL + caption, then publish that container. The image_url MUST be publicly
 *  reachable (our /api/release/og card, absolute via NEXT_PUBLIC_APP_URL). */
export async function publishInstagram(
  post: PublishablePost,
  config: InstagramConfig,
): Promise<PublishResult> {
  if (!post.imageUrl) {
    return {
      ok: false,
      error: "Instagram needs an image; this post has none.",
    };
  }
  try {
    const create = (await (
      await fetch(`${GRAPH}/${config.igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: post.imageUrl,
          caption: post.body,
          access_token: config.accessToken,
        }),
      })
    )
      .json()
      .catch(() => ({}))) as GraphReply;
    if (!create.id) {
      return {
        ok: false,
        error: `Instagram container: ${create.error?.message ?? "failed"}`,
      };
    }

    const publish = (await (
      await fetch(`${GRAPH}/${config.igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: create.id,
          access_token: config.accessToken,
        }),
      })
    )
      .json()
      .catch(() => ({}))) as GraphReply;
    if (!publish.id) {
      return {
        ok: false,
        error: `Instagram publish: ${publish.error?.message ?? "failed"}`,
      };
    }
    return { ok: true, id: publish.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Instagram request failed.",
    };
  }
}
