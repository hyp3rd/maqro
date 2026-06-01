/** Next.js instrumentation hook. Runs once per server process boot,
 *  before any route handler is invoked.
 *
 *  We use this purely for env validation. The goal is "fail fast":
 *  if a production deploy is missing required env or has incoherent
 *  config (e.g., STRIPE_SECRET_KEY without STRIPE_WEBHOOK_SECRET),
 *  the deploy should crash on boot rather than 500-ing the first
 *  user request hours later.
 *
 *  Runs only in the Node.js runtime — the Edge runtime ignores it
 *  and reads its own restricted env at the worker level.
 *
 *  See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv, formatEnvIssues } = await import("./lib/env");
  const issues = validateEnv();
  if (issues.length === 0) return;

  const summary = formatEnvIssues(issues);
  const hasError = issues.some((i) => i.severity === "error");

  // In production, an `error`-severity issue is a hard stop: any
  // feature that depends on the misconfigured key will break in
  // unpredictable ways the moment it's invoked. Crash the boot
  // instead and let the deploy platform surface the failure.
  //
  // In development/test we log + continue so contributors can iterate
  // on the app without having every Stripe / Resend / VAPID key set
  // locally.
  if (hasError && process.env.NODE_ENV === "production") {
    throw new Error(summary);
  }

  // Pick the severity that matches the worst issue found. A
  // single error-severity issue means a feature WILL break the
  // moment it's invoked — that deserves `console.error` so it
  // shows up red in the platform logs (and gets escalated by any
  // log forwarder that filters on severity). Only warnings →
  // `console.warn`. Previously this was always `warn`, which
  // under-reported real config breakage on preview deploys
  // (NODE_ENV !== "production" but very much a deployed env).
  if (hasError) {
    console.error(summary);
  } else {
    console.warn(summary);
  }
}
