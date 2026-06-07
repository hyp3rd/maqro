/** Shared types for release marketing automation — AI-drafted, human-approved
 *  social posts. Pure types, no runtime deps, so the server routes and the admin
 *  UI both import from here. */

export const SOCIAL_PLATFORMS = ["x", "linkedin", "instagram"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
};

/** Hard character ceiling per platform — drives the tone-lint length flag and
 *  the editor counter. X enforces 280; the others are generous but kept sane. */
export const PLATFORM_MAX_CHARS: Record<SocialPlatform, number> = {
  x: 280,
  linkedin: 2800,
  instagram: 2000,
};

export type CampaignStatus = "draft" | "approved" | "published" | "skipped";
export type PostStatus = "draft" | "approved" | "published" | "failed";

export type SocialCampaign = {
  id: string;
  changelogId: string;
  title: string;
  version: string | null;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
};

export type SocialPost = {
  id: string;
  campaignId: string;
  platform: SocialPlatform;
  body: string;
  imageUrl: string | null;
  status: PostStatus;
  publishedId: string | null;
  publishedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The generator's per-platform output, before it's linted + persisted. */
export type GeneratedPost = { platform: SocialPlatform; body: string };

/** The fields a publish adapter needs (platform decides the adapter; body is the
 *  text; imageUrl is the Instagram card). */
export type PublishablePost = Pick<
  SocialPost,
  "platform" | "body" | "imageUrl"
>;

/** Outcome of a publish-adapter call. `id` is the platform post id; `url` a
 *  permalink when one can be formed. */
export type PublishResult =
  | { ok: true; id: string; url?: string }
  | { ok: false; error: string };

/** LinkedIn connection state for the dashboard. `source` distinguishes a stored
 *  OAuth connection (auto-refreshing) from a manual env token (no refresh). */
export type LinkedInStatus = {
  connected: boolean;
  source: "oauth" | "env" | "none";
  expiresAt: string | null;
  canAutoRefresh: boolean;
};

/** What the page hands the dashboard: the status plus whether the OAuth
 *  "Connect" flow is even available (app creds + encryption key present). */
export type LinkedInPanel = LinkedInStatus & { oauthConfigured: boolean };
