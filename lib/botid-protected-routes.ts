import type { initBotId } from "botid/client/core";

type BotIdProtectedRoute = Parameters<typeof initBotId>[0]["protect"][number];

/** The routes Vercel BotID's client attaches its challenge headers to.
 *  Passed to `initBotId()` in the root `instrumentation-client.ts`.
 *
 *  This list must match the server exactly: every route handler that runs
 *  `requireHumanDeep()` / `checkBotId()` needs an entry with the same method
 *  and `checkLevel`, or `checkBotId()` sees no `x-is-human` header and the
 *  fail-closed gate 403s every real user. `instrumentation-client.test.ts`
 *  derives the gated routes from the source and enforces the match both
 *  ways, so a gate cannot be added (or removed) without this list following.
 *
 *  Entries are deliberately limited to server-gated routes: an entry without
 *  a server check would only make the client run the challenge (a script
 *  load, plus Kasada's SDK for deep analysis) for no protection.
 *
 *  Scope today: the admin Stripe-webhook replay, the one deep-analysis gate.
 *  Checkout, delete-account and lost-email recovery dropped their gates (see
 *  the notes in those route files and `lib/bot-protection.ts`).
 *
 *  Path syntax: `*` matches any run of characters, including `/`
 *  (botid turns it into `.*` in an anchored regex).
 *  See https://vercel.com/docs/botid/get-started and
 *  https://vercel.com/docs/botid/advanced-configuration. */
export const BOTID_PROTECTED_ROUTES: readonly BotIdProtectedRoute[] = [
  {
    path: "/api/admin/webhooks/*/replay",
    method: "POST",
    advancedOptions: { checkLevel: "deepAnalysis" },
  },
];
