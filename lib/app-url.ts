/** Resolves the canonical public URL for the running deployment.
 *
 *  Resolution order, most-specific first:
 *
 *    1. `NEXT_PUBLIC_APP_URL` — the only way to bind links to a
 *       custom branded domain (`https://maqro.app`). Set this in
 *       Vercel → Project → Settings → Environment Variables for
 *       the Production environment (and leave it unset in Preview
 *       so previews self-link).
 *
 *    2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel injects this on
 *       every deployment of the project; it's the *project's*
 *       production alias (e.g. `maqro.vercel.app`),
 *       stable across deploys. Preferred over VERCEL_URL because
 *       VERCEL_URL is the per-build alias (`…-9tr8pbgs9-….vercel.app`)
 *       which churns on every commit and is the wrong target for
 *       email links shipped by the daily cron — by the time a user
 *       clicks a recap email two weeks later, that specific build
 *       has long since been rotated out of the URL's resolution.
 *
 *    3. `VERCEL_URL` — last-resort Vercel signal. Only useful in
 *       preview deployments to make self-referential previews work;
 *       any production link reaching this branch means
 *       `VERCEL_PROJECT_PRODUCTION_URL` is also missing, which is
 *       unusual.
 *
 *    4. Localhost fallback for `next dev` and tests.
 *
 *  Always returns a value without a trailing slash so callers can
 *  safely concatenate `/path`. Any user-supplied URL with a trailing
 *  slash gets normalized here so a stray `/` in the env var doesn't
 *  produce `https://maqro.app//app?view=settings` in emails. */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return stripTrailingSlash(explicit);

  const projectProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (projectProdUrl) return `https://${stripTrailingSlash(projectProdUrl)}`;

  const perDeploymentUrl = process.env.VERCEL_URL;
  if (perDeploymentUrl) {
    return `https://${stripTrailingSlash(perDeploymentUrl)}`;
  }

  return "http://localhost:3000";
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
