/** Fire-and-forget client helper for the onboarding funnel.
 *
 *  Three things matter here, in order:
 *
 *    1. **Never block the wizard.** A failed POST should be totally
 *       invisible to the user. We don't await, we don't throw, we
 *       don't `.catch` to anything noisy.
 *
 *    2. **Aggregate-only on the wire.** The wire payload carries
 *       only `{ step, action }`. No user_id, no IP (the route ignores
 *       it for storage), no session token. See migration 0042 for the
 *       privacy rationale.
 *
 *    3. **Idempotency-safe.** The server-side counter is monotonic
 *       increment. Sending the same event twice double-counts (which
 *       skews the funnel slightly) but never corrupts state. The
 *       wizard wiring is structured so each transition fires exactly
 *       once.
 *
 *  Browser-only: this module is imported by the wizard, which is a
 *  client component. SSR-imported callers would hit `fetch` outside
 *  a request context — guarded with the typeof-window check so it
 *  no-ops cleanly in those cases. */

export type OnboardingAction = "enter" | "skip" | "finish";

export function emitOnboardingEvent(opts: {
  step: number;
  action: OnboardingAction;
}): void {
  if (typeof window === "undefined") return;
  // `keepalive: true` lets the browser ship the POST even if the
  // user navigates away mid-flight (the `finish` event on the last
  // step fires immediately before the dialog closes and the parent
  // re-renders). Without it, fast-closing transitions could drop
  // the terminal counter bump.
  try {
    void fetch("/api/onboarding/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: opts.step, action: opts.action }),
      keepalive: true,
    }).catch(() => {
      // Swallowed by design — telemetry must never break the user's
      // onboarding. The next session's first event will reveal that
      // the route is up if it ever wasn't.
    });
  } catch {
    // Same reason — the wizard runs regardless.
  }
}
