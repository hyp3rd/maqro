import type { XConfig } from "@/lib/social/env";
import type { PublishablePost, PublishResult } from "@/lib/social/types";
import { createHmac, randomBytes } from "node:crypto";

const ENDPOINT = "https://api.twitter.com/2/tweets";

/** RFC 3986 percent-encoding — stricter than encodeURIComponent (it also encodes
 *  ! * ' ( )), as OAuth 1.0a signatures require. */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Build the OAuth 1.0a Authorization header for a JSON-body POST. Because the
 *  body is application/json (not form-encoded), only the oauth_* params sign;
 *  the JSON payload is excluded from the signature base. */
function oauthHeader(config: XConfig, method: string, url: string): string {
  const params: Record<string, string> = {
    oauth_consumer_key: config.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: config.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(paramString)}`;
  const signingKey = `${rfc3986(config.apiSecret)}&${rfc3986(config.accessSecret)}`;
  params.oauth_signature = createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");
  return (
    "OAuth " +
    Object.keys(params)
      .sort()
      .map((k) => `${rfc3986(k)}="${rfc3986(params[k])}"`)
      .join(", ")
  );
}

export async function publishX(
  post: PublishablePost,
  config: XConfig,
): Promise<PublishResult> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: oauthHeader(config, "POST", ENDPOINT),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: post.body }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      detail?: string;
      title?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: `X ${res.status}: ${data.detail ?? data.title ?? "request failed"}`,
      };
    }
    const id = data.data?.id ?? "";
    return {
      ok: true,
      id,
      url: id ? `https://x.com/i/web/status/${id}` : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "X request failed.",
    };
  }
}
