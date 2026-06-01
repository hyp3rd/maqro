/** Best-effort classifier: was this error raised because the caller's
 *  Supabase session is no longer valid? We use this in `triggerSync`
 *  to decide between "transient sync hiccup, leave the user alone"
 *  (e.g. a 502 from a noisy hop) and "auth is gone, drop the local
 *  state and re-prompt" (a JWT expired in the middle of a long
 *  session, the refresh token rotated, the row's RLS no longer
 *  resolves because the user was deleted server-side, …).
 *
 *  Supabase doesn't ship a single canonical error class for this —
 *  the AuthApiError, the PostgrestError, and the generic fetch path
 *  each carry the signal in a different field. So we sniff multiple
 *  surfaces: numeric `status`, the PostgREST `code` family that
 *  signals invalid/expired JWTs, and a small set of message
 *  substrings that Supabase emits in plaintext. Pure / no I/O so
 *  it's safe to call from a sync error boundary. */
export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const obj = err as Record<string, unknown>;
  if (obj.status === 401) return true;
  if (typeof obj.code === "string") {
    // PGRST301: "JWT expired". PGRST302: "Anonymous access not
    // allowed". Both mean the caller's identity is broken from
    // PostgREST's perspective.
    if (obj.code === "PGRST301" || obj.code === "PGRST302") return true;
  }
  if (typeof obj.message === "string") {
    const msg = obj.message.toLowerCase();
    if (msg.includes("jwt expired")) return true;
    if (msg.includes("invalid jwt")) return true;
    if (msg.includes("auth session missing")) return true;
    if (msg.includes("invalid refresh token")) return true;
    if (msg.includes("refresh token not found")) return true;
    if (msg.includes("user not found")) return true;
  }
  return false;
}
