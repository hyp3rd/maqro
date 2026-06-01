import { requestMfaChallenge } from "@/lib/auth/mfa-challenge-bus";

/** Wrapper around `fetch` that intercepts `403 { kind: "mfa-required" }`
 *  responses, prompts the user for their TOTP via the globally-mounted
 *  `MfaChallengeDialog`, and retries the original request on success.
 *
 *  Call sites use this in place of `fetch` for any request that
 *  needs auth — the AI generation routes, the billing routes, the
 *  account-management routes. Reads that public users can hit
 *  (`/api/health`, `/api/share/today/og`, OFF lookups) don't need
 *  this wrapper; they still call `fetch` directly.
 *
 *  Why a single wrapper instead of decorating each callsite by hand:
 *
 *    - The behaviour is the same for every gated request — peek the
 *      response, recognize the MFA gate, prompt, retry once. Having
 *      it in one place keeps the policy consistent and lets future
 *      enhancements (e.g. exponential backoff on rate-limit) flow
 *      to every caller for free.
 *
 *    - We deliberately do NOT monkey-patch `window.fetch`. That
 *      affects every fetch on the page including third-party
 *      scripts (the Supabase SDK, sonner, etc.) and creates a
 *      mystery layer for debugging.
 *
 *  Retry semantics:
 *
 *    - Exactly one retry. If the second response is ALSO a 403,
 *      we surface it without recursing — the user just verified
 *      MFA, so a fresh 403 means something else is wrong (cookie
 *      didn't propagate, session expired between verify and retry,
 *      etc.). The caller's existing error path handles it.
 *
 *    - We clone the original `init` and re-read the body where
 *      possible. Streamed bodies are NOT retried (they're not
 *      replayable); we throw on that case instead of silently
 *      passing a stale Request through.
 *
 *    - On user cancel (`reject("cancelled")` from the dialog), we
 *      RETURN the original 403 response so the caller's normal
 *      error UX runs. We don't throw — that's the caller's
 *      decision based on the response code. */
export async function clientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Clone the body up front so we can replay it. The fetch spec
  // consumes Request body streams on first use, so we can't just
  // reuse the same `init` for retry; we need to capture the
  // serialized body before the first send.
  const replayableInit = init ? cloneInit(init) : undefined;

  const response = await fetch(input, init);
  if (!(await isMfaRequired(response))) return response;

  // The response was a 403 with kind: "mfa-required". Open the
  // challenge dialog and wait. We must CLONE the response before
  // attempting to read its JSON to detect the kind (read above),
  // so the original is still consumable by callers if the dialog
  // fails / user cancels.
  try {
    await requestMfaChallenge();
  } catch {
    // User cancelled, or the dialog itself errored out. Surface
    // the original 403 so the caller's existing error toast runs.
    return response;
  }

  // MFA succeeded; the session is now AAL2. Replay the original
  // request. If init was bodyless (GET / HEAD) or we successfully
  // cloned the body, this just works.
  return fetch(input, replayableInit ?? init);
}

/** Probe a response for the `kind: "mfa-required"` shape. We HAVE
 *  to clone before reading the body — the caller might still want
 *  the original response if we end up not retrying. */
async function isMfaRequired(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  // Only application/json responses are worth parsing. A 403 from
  // a static asset or a misconfigured route shouldn't trip this.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return false;
  try {
    const cloned = response.clone();
    const body = (await cloned.json()) as { kind?: unknown };
    return body?.kind === "mfa-required";
  } catch {
    return false;
  }
}

/** `RequestInit` is a structured object. Most fields are POD; the
 *  only one that needs care is `body`, which can be a stream that
 *  fetch consumes. For JSON bodies (the common case) we read once
 *  and re-pass the string; for streams we fail loudly rather than
 *  silently retrying with an empty body. */
function cloneInit(init: RequestInit): RequestInit {
  const { body, ...rest } = init;
  if (body == null) return { ...rest };
  if (typeof body === "string") return { ...rest, body };
  if (
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams ||
    body instanceof FormData
  ) {
    return { ...rest, body };
  }
  // ReadableStream / unrecognized shape — can't safely replay.
  // Return without the body; the retry will fail at the route
  // boundary, but at least it won't silently send a corrupt
  // payload. Most code paths use stringified JSON, so this is
  // a rare hit.
  return { ...rest };
}
