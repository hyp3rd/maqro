"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

/** The application itself. Previously lived at `/` — moved to `/app` so the
 *  root can host a marketing landing page. PWA start_url + post-login redirect
 *  both point here.
 *
 *  `MacroCalculator` is loaded **client-only** (`ssr: false`): the whole app
 *  shell derives from client state (IndexedDB / localStorage / the live
 *  session), so server-rendering it just emits defaults that mismatch the real
 *  client state on hydration — the recurring prod React #418. `/app` is
 *  dynamically rendered (the root layout awaits next-intl's locale/messages),
 *  which is what forces this otherwise-client component to SSR in the first
 *  place. There's no SEO need here (the marketing page is the separate `/`
 *  route), and the shell renders entirely client-side anyway — so rendering it
 *  client-only means its subtree is never hydrated, and no server↔client
 *  mismatch is possible.
 *
 *  The `<Suspense>` wrapper stays: `MacroCalculator` reads `?upgrade=…` via
 *  `useSearchParams`, and the boundary satisfies the production build's
 *  "useSearchParams() should be wrapped in a suspense boundary" check. The
 *  fallback is `null` — there's no meaningful pre-hydration UI to show. */
const MacroCalculator = dynamic(() => import("../../macro-calculator"), {
  ssr: false,
});

export default function AppPage() {
  return (
    <Suspense fallback={null}>
      <MacroCalculator />
    </Suspense>
  );
}
