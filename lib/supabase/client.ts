"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_CONFIG } from "./env";
import { storedSessionUserId } from "./stored-session";

let cached: SupabaseClient | null = null;

/** Browser-side Supabase client. Returns `null` if env vars are missing
 * (the app runs in guest mode in that case). Callers should null-check
 * before using.
 *
 * `experimental.passkey: true` opts into the SDK's WebAuthn helpers
 * (`signInWithPasskey`, `registerPasskey`, `passkey.list/update/delete`).
 * Without the flag every passkey method throws via the SDK's
 * `assertPasskeyExperimentalEnabled` guard. The corresponding server-
 * side flag lives in [server.ts](./server.ts) and MUST stay in sync —
 * a passkey enrolled via the browser client won't validate against a
 * server client that didn't opt in. */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (!SUPABASE_CONFIG) return null;
  cached ??= createBrowserClient(
    SUPABASE_CONFIG.url,
    SUPABASE_CONFIG.publishableKey,
    { auth: { experimental: { passkey: true } } },
  );
  return cached;
}

/** The user id of the session the browser client keeps in storage, expired
 *  or not ([stored-session.ts](./stored-session.ts)), or `null` when none is
 *  stored, it can't be read, or Supabase isn't configured. */
export function readStoredSessionUserId(): Promise<string | null> {
  if (!SUPABASE_CONFIG) return Promise.resolve(null);
  return storedSessionUserId(SUPABASE_CONFIG.url, document.cookie);
}
