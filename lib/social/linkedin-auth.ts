import { getAppUrl } from "@/lib/app-url";
import { getSocialConfig, type LinkedInConfig } from "@/lib/social/env";
import {
  decryptSecret,
  encryptSecret,
  tokenSecretConfigured,
} from "@/lib/social/token-crypto";
import type { LinkedInStatus } from "@/lib/social/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REDIRECT_PATH = "/api/admin/social/linkedin/callback";
const SCOPES = "w_organization_social r_organization_social";
const LINKEDIN_VERSION = "202605";
// Refresh slightly before the real expiry so a publish never races the boundary.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** CSRF state cookie shared by the OAuth connect + callback handlers. */
export const STATE_COOKIE = "li_oauth_state";

function clientId() {
  return process.env.LINKEDIN_CLIENT_ID?.trim() || undefined;
}
function clientSecret() {
  return process.env.LINKEDIN_PRIMARY_CLIENT_SECRET?.trim() || undefined;
}
function redirectUri() {
  return `${getAppUrl()}${REDIRECT_PATH}`;
}

/** OAuth connect needs the app creds AND the at-rest encryption key. */
export function linkedInOAuthConfigured(): boolean {
  return Boolean(clientId() && clientSecret() && tokenSecretConfigured());
}

export function authorizeUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: clientId() ?? "",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

type TokenReply = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

async function tokenRequest(
  grant: Record<string, string>,
): Promise<TokenReply> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId() ?? "",
      client_secret: clientSecret() ?? "",
      ...grant,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `LinkedIn token ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return (await res.json()) as TokenReply;
}

/** Prefer the explicit LINKEDIN_ORG_ID; else the first org the member admins. */
async function resolveOrgUrn(accessToken: string): Promise<string> {
  const explicit = process.env.LINKEDIN_ORG_ID?.trim();
  if (explicit) return `urn:li:organization:${explicit}`;
  const res = await fetch(
    "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": LINKEDIN_VERSION,
      },
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    elements?: { organization?: string }[];
  };
  const urn = data.elements?.[0]?.organization;
  if (!urn) {
    throw new Error("No administered organization found. Set LINKEDIN_ORG_ID.");
  }
  return urn;
}

type Stored = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  refreshExpiresAt: number | null;
  orgUrn: string;
  scope: string | null;
};

async function persist(admin: SupabaseClient, s: Stored): Promise<void> {
  await admin
    .from("linkedin_oauth")
    .upsert({
      id: true,
      access_token: encryptSecret(s.accessToken),
      refresh_token: s.refreshToken ? encryptSecret(s.refreshToken) : null,
      expires_at: new Date(s.expiresAt).toISOString(),
      refresh_expires_at: s.refreshExpiresAt
        ? new Date(s.refreshExpiresAt).toISOString()
        : null,
      org_urn: s.orgUrn,
      scope: s.scope,
    });
}

/** Exchange the auth code, resolve the org, store the encrypted tokens. */
export async function connectLinkedIn(
  admin: SupabaseClient,
  code: string,
): Promise<void> {
  const tok = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
  const orgUrn = await resolveOrgUrn(tok.access_token);
  const now = Date.now();
  await persist(admin, {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? null,
    expiresAt: now + tok.expires_in * 1000,
    refreshExpiresAt: tok.refresh_token_expires_in
      ? now + tok.refresh_token_expires_in * 1000
      : null,
    orgUrn,
    scope: tok.scope ?? null,
  });
}

type LinkedInRow = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  refresh_expires_at: string | null;
  org_urn: string;
  scope: string | null;
};

/** A valid access token + org urn, refreshing if near expiry. Falls back to a
 *  manually-set env token (the pre-OAuth path). null when nothing usable. */
export async function getValidLinkedInAuth(
  admin: SupabaseClient,
): Promise<LinkedInConfig | null> {
  const { data } = await admin
    .from("linkedin_oauth")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const row = data as LinkedInRow | null;
  if (!row) return getSocialConfig().linkedin; // pre-OAuth static env token

  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() < expiresAt - REFRESH_SKEW_MS) {
    return {
      accessToken: decryptSecret(row.access_token),
      orgUrn: row.org_urn,
    };
  }

  // Expiring/expired — refresh if we still can.
  if (!row.refresh_token) return null;
  if (
    row.refresh_expires_at &&
    Date.now() > new Date(row.refresh_expires_at).getTime()
  ) {
    return null;
  }
  try {
    const tok = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(row.refresh_token),
    });
    const now = Date.now();
    await persist(admin, {
      accessToken: tok.access_token,
      // LinkedIn may not re-issue a refresh token on refresh; keep the old one.
      refreshToken: tok.refresh_token ?? decryptSecret(row.refresh_token),
      expiresAt: now + tok.expires_in * 1000,
      refreshExpiresAt: tok.refresh_token_expires_in
        ? now + tok.refresh_token_expires_in * 1000
        : row.refresh_expires_at
          ? new Date(row.refresh_expires_at).getTime()
          : null,
      orgUrn: row.org_urn,
      scope: tok.scope ?? row.scope,
    });
    return { accessToken: tok.access_token, orgUrn: row.org_urn };
  } catch {
    return null;
  }
}

/** Lightweight status for the dashboard — no refresh side effect. */
export async function linkedInStatus(
  admin: SupabaseClient,
): Promise<LinkedInStatus> {
  const { data } = await admin
    .from("linkedin_oauth")
    .select("expires_at, refresh_token, refresh_expires_at")
    .eq("id", true)
    .maybeSingle();
  const row = data as Pick<
    LinkedInRow,
    "expires_at" | "refresh_token" | "refresh_expires_at"
  > | null;
  if (row) {
    const canAutoRefresh = Boolean(
      row.refresh_token &&
      (!row.refresh_expires_at ||
        Date.now() < new Date(row.refresh_expires_at).getTime()),
    );
    return {
      connected: true,
      source: "oauth",
      expiresAt: row.expires_at,
      canAutoRefresh,
    };
  }
  if (getSocialConfig().linkedin) {
    return {
      connected: true,
      source: "env",
      expiresAt: null,
      canAutoRefresh: false,
    };
  }
  return {
    connected: false,
    source: "none",
    expiresAt: null,
    canAutoRefresh: false,
  };
}
