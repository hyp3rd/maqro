/** User-facing copy for the offline-unverified state (`isOfflineUnverified`
 *  in hooks/use-user.ts): the account's local data is shown, but its
 *  identity can't be verified because the auth server can't be reached.
 *
 *  That happens with no network, but also online, when the auth server
 *  answers with a 5xx (auth-js reports 500–504 and Cloudflare's 520–530 as
 *  the same retryable error as a failed fetch). So the copy never says
 *  "offline" or "reconnect". One source, so the account menu and the usage
 *  card say the same thing. */

/** Short label, for where space is tight (the sidebar account chip). */
export const OFFLINE_UNVERIFIED_LABEL = "Server unreachable";

/** The full explanation. */
export const OFFLINE_UNVERIFIED_HINT =
  "Can't reach the account server — your data stays on this device";
