"use client";

import { Suspense } from "react";
import MacroCalculator from "../../macro-calculator";

/** The application itself. Previously lived at `/` — moved to
 *  `/app` so the root can host a marketing landing page. PWA
 *  start_url + post-login redirect both point here.
 *
 *  The `<Suspense>` wrapper is required because `MacroCalculator`
 *  reads `?upgrade=…` via `useSearchParams`, which forces the
 *  prerender to bail out and emit a suspense boundary. Without one,
 *  the production build fails with "useSearchParams() should be
 *  wrapped in a suspense boundary". The fallback is `null` — the
 *  app's shell renders entirely client-side anyway, so there's no
 *  meaningful pre-hydration UI to show. */
export default function AppPage() {
  return (
    <Suspense fallback={null}>
      <MacroCalculator />
    </Suspense>
  );
}
