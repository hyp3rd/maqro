import type { SocialPlatform } from "@/lib/social/types";

/** Server-only credential accessors for the publish adapters. The single typed
 *  boundary over `process.env` for social tokens (mirrors getAnthropicConfig /
 *  getStripe). A platform returns `null` until ALL its required vars are set, so
 *  the publish route falls back to the manual "mark posted" path. */

export type LinkedInConfig = {
  /** Bearer token with `w_organization_social`, obtained via OAuth. */
  accessToken: string;
  /** `urn:li:organization:{id}` — the page that authors the post. */
  orgUrn: string;
};

export type XConfig = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

export type InstagramConfig = {
  /** The IG Business account id (not the page id). */
  igUserId: string;
  /** A long-lived page access token with instagram_content_publish. */
  accessToken: string;
};

export type SocialConfig = {
  x: XConfig | null;
  linkedin: LinkedInConfig | null;
  instagram: InstagramConfig | null;
};

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

function linkedInConfig(): LinkedInConfig | null {
  // LINKEDIN_CLIENT_ID / LINKEDIN_PRIMARY_CLIENT_SECRET / LINKEDIN_PAGE_URL are
  // the OAuth app creds (for obtaining a token) — posting itself needs the
  // resulting access token + the numeric organization id.
  const accessToken = env("LINKEDIN_ACCESS_TOKEN");
  const orgId = env("LINKEDIN_ORG_ID");
  if (!accessToken || !orgId) return null;
  return { accessToken, orgUrn: `urn:li:organization:${orgId}` };
}

function xConfig(): XConfig | null {
  const apiKey = env("X_API_KEY");
  const apiSecret = env("X_API_SECRET");
  const accessToken = env("X_ACCESS_TOKEN");
  const accessSecret = env("X_ACCESS_SECRET");
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

function instagramConfig(): InstagramConfig | null {
  const igUserId = env("META_IG_USER_ID");
  const accessToken = env("META_ACCESS_TOKEN");
  if (!igUserId || !accessToken) return null;
  return { igUserId, accessToken };
}

export function getSocialConfig(): SocialConfig {
  return {
    x: xConfig(),
    linkedin: linkedInConfig(),
    instagram: instagramConfig(),
  };
}

/** Which platforms can actually publish (vs. manual mark-posted). Used by the
 *  dashboard to label the action button. */
export function configuredPlatforms(): Record<SocialPlatform, boolean> {
  const c = getSocialConfig();
  return {
    x: c.x !== null,
    linkedin: c.linkedin !== null,
    instagram: c.instagram !== null,
  };
}
