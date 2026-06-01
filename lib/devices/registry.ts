"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOrCreateDeviceId,
  inferDeviceLabel,
  sessionIdFromAccessToken,
} from "./identity";

/** Shape of a `user_devices` row as returned by Supabase. The
 *  Settings UI and the disconnect endpoint share this type.
 *
 *  `device_id` is the stable per-browser identifier introduced in
 *  migration 0028. Nullable for legacy rows created before that
 *  migration shipped — the UI tolerates a null here without
 *  rendering anything special. */
export type DeviceRow = {
  id: string;
  user_id: string;
  session_id: string;
  device_id: string | null;
  device_label: string | null;
  user_agent: string | null;
  ip_address: string | null;
  geo_city: string | null;
  geo_country: string | null;
  geo_region: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

/** Extract the session_id from the current Supabase access token.
 *  Returns null when there's no session or the access token doesn't
 *  carry a session_id claim (very old SDK or a token issued before a
 *  schema change). Callers use null as a signal to skip device
 *  registration / lookup silently. */
export async function getCurrentSessionId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return null;
  return sessionIdFromAccessToken(accessToken);
}

/** Register the current device. Posts to `/api/devices/register`
 *  rather than upserting from the client directly because the row
 *  needs the request's IP + geo, neither of which the browser can
 *  observe reliably (proxies, VPNs, no JS API for the egress IP).
 *  The route captures both from request headers.
 *
 *  Identity: prefers the stable `device_id` from localStorage (see
 *  `getOrCreateDeviceId`) so re-sign-ins on the same browser hit
 *  the existing row instead of creating duplicates. Falls back to
 *  `session_id` only on the server when localStorage was
 *  unavailable here. The `device_id` may be null in restricted
 *  webviews — the server handles that gracefully.
 *
 *  Idempotent: the route does its own lookup (device_id first, then
 *  session_id) and either inserts or bumps `last_seen_at`,
 *  preserving any user-edited `device_label`. Best-effort: a
 *  failure here doesn't block sync, just means the device won't
 *  show in Settings until the next sync re-registers it. */
export async function registerCurrentDevice(
  supabase: SupabaseClient,
): Promise<void> {
  // No userId param — the /api/devices/register route reads it from
  // the cookie session, which is the only trustworthy source server-
  // side anyway. Adding a client-provided userId here would just be
  // ignored by the route.
  const sessionId = await getCurrentSessionId(supabase);
  if (!sessionId) return;

  const deviceId = getOrCreateDeviceId();
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const deviceLabel = inferDeviceLabel(userAgent);

  await fetch("/api/devices/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, deviceId, userAgent, deviceLabel }),
  }).catch(() => {
    // Network error — the next sync's registration will try again.
  });
}

/** Unregister the current device — called pre-signOut so the user's
 *  device list doesn't accumulate stale rows for sessions they've
 *  explicitly terminated. The remote-disconnect path goes through
 *  the admin route, which deletes the row server-side.
 *
 *  Deletion key priority mirrors registration:
 *    1. `device_id` — preferred, survives session rotation.
 *    2. `session_id` — fallback when localStorage isn't available
 *       (legacy rows or restricted webviews). */
export async function unregisterCurrentDevice(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  if (deviceId) {
    await supabase
      .from("user_devices")
      .delete()
      .eq("user_id", userId)
      .eq("device_id", deviceId);
    return;
  }
  const sessionId = await getCurrentSessionId(supabase);
  if (!sessionId) return;
  await supabase
    .from("user_devices")
    .delete()
    .eq("user_id", userId)
    .eq("session_id", sessionId);
}
