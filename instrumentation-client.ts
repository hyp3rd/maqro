import { BOTID_PROTECTED_ROUTES } from "@/lib/botid-protected-routes";
import { reportClientError } from "@/lib/error-reporter";
import { installErrorCapture } from "@/lib/install-error-capture";
import { initBotId } from "botid/client/core";

/** Next.js client instrumentation — runs once in the browser BEFORE the
 *  app hydrates. Next only loads this file from the project root (or
 *  `src/`), so every client-side init that must run app-wide lives here.
 *
 *  1. Error capture first, early enough to catch React hydration
 *     mismatches (#418/#423/#425), which fire during hydration and so are
 *     invisible to any handler installed later in a component effect. See
 *     [lib/install-error-capture.ts](./lib/install-error-capture.ts).
 *  2. Vercel BotID: patches `fetch` / XHR so requests to the routes in
 *     [lib/botid-protected-routes.ts](./lib/botid-protected-routes.ts)
 *     carry the challenge headers the server-side `checkBotId()` needs.
 *     Nothing loads until such a request is made. A failure here is
 *     reported and contained (as the Next.js docs advise for
 *     instrumentation) so it cannot stop the app from starting; the
 *     protected routes then fail closed server-side.
 *     See https://vercel.com/docs/botid/get-started. */
installErrorCapture();

try {
  initBotId({ protect: [...BOTID_PROTECTED_ROUTES] });
} catch (err) {
  reportClientError(err, { context: { step: "initBotId" } });
}
