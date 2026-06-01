import type { MfaUpgradeOptions } from "@/lib/auth/mfa-required";
import { validateDeviceId, DEVICE_ID_COOKIE } from "@/lib/devices/identity";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Server-side check: does the caller's browser hold an unexpired
 *  "trust this device for 7 days" grant? Returns `true` only when:
 *
 *    - The request carries the `DEVICE_ID_COOKIE` with a UUID-shaped
 *      value (anything else collapses to false — tampered cookies
 *      can't grant trust);
 *    - A row exists in `mfa_trusted_devices` for this user_id +
 *      device_id whose `trusted_until` is strictly in the future.
 *
 *  The DB row is the source of truth; the cookie just identifies
 *  *which* device. A stolen cookie alone grants nothing — it'd need
 *  to land in a session that's already authenticated as the same
 *  user to match a row.
 *
 *  Default-deny on errors: an outage on the table read returns
 *  `false` so a Supabase blip can never auto-bypass MFA.
 *
 *  Why this lives next to `requiresMfaUpgrade`: both the proxy
 *  (page-nav gate) and `assertAal2` (API-route gate) need to honor
 *  the same trust grant or the user experience splits — the page
 *  would load but every API call would 403. Keeping a single
 *  helper means both gates always agree. */
export type CookieSource = {
  /** Read a cookie value by name. Matches the shape of both
   *  `NextRequest.cookies.get(name)?.value` and Next's
   *  `cookies().get(name)?.value` so callers can pass either. */
  get(name: string): { value: string } | undefined;
};

export async function isCurrentDeviceTrusted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  cookieSource: CookieSource,
): Promise<boolean> {
  const raw = cookieSource.get(DEVICE_ID_COOKIE)?.value;
  const deviceId = validateDeviceId(raw);
  if (!deviceId) return false;

  try {
    const { data, error } = await supabase
      .from("mfa_trusted_devices")
      .select("id")
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .gt("trusted_until", new Date().toISOString())
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/** API-route convenience: build the `MfaUpgradeOptions` payload that
 *  threads the trust check into `assertAal2`. Resolves the cookies
 *  via Next's per-request `cookies()` so callers don't have to know
 *  about the cookie name. One line at every API route:
 *
 *  ```ts
 *  const gate = await assertAal2(
 *    supabase,
 *    await trustedDeviceOption(supabase, user.id),
 *  );
 *  ```
 *
 *  Returns an empty options object (no trust check) when `cookies()`
 *  isn't available — covers two cases:
 *
 *    - Unit tests calling the route handler directly outside a Next
 *      request scope. Without this fallback every existing route test
 *      crashes inside `cookies()`. The empty options keep the gate
 *      strict (AAL2 only), which is correct for tests.
 *    - Edge cases where Next decides the route is dynamic-not-static
 *      and the cookies API isn't bound. We'd rather degrade to
 *      strict-AAL2 than 500 the request.
 *
 *  Resolves cookies eagerly even when no MFA is in scope — `cookies()`
 *  is per-request scoped data, not a network call, so the cost is
 *  negligible and the `isTrustedDevice` predicate stays sync-clean
 *  for `requiresMfaUpgrade`. */
export async function trustedDeviceOption(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<MfaUpgradeOptions> {
  let cookieStore: Awaited<ReturnType<typeof cookies>>;
  try {
    cookieStore = await cookies();
  } catch {
    // Called outside a Next request scope (tests, edge cases). Skip
    // the trust check — gate stays strict AAL2.
    return {};
  }
  return {
    isTrustedDevice: () =>
      isCurrentDeviceTrusted(supabase, userId, cookieStore),
  };
}
