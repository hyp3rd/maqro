import { reportServerError } from "@/lib/error-reporter";
import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";

/** Thin wrapper around Vercel BotID's `checkBotId()` for the
 *  deep-tier routes — checkout, delete-account, admin webhook
 *  replay, lost-email recovery. These are the only routes where
 *  a false negative is irrecoverable enough to justify the
 *  false-positive friction of BotID's classifier.
 *
 *  History: this module previously exported a `requireHuman()`
 *  helper that gated the basic-tier routes (AI calls,
 *  backup-email lifecycle, push-subscribe, billing portal) in
 *  observe-mode. We removed it after observing in production
 *  that BotID's basic-tier classifier consistently flagged Arc
 *  browser sessions and installed PWAs as bot — a real chunk of
 *  the user base. The basic-tier routes already have meaningful
 *  abuse caps (per-user AI usage limits, single-row pending
 *  state on backup-email, RLS on push subscriptions), so the
 *  classifier was producing pure noise. Anything basic-tier that
 *  wants automated-traffic gating should rely on those existing
 *  layers + Vercel firewall's static rules, not on this helper.
 *
 *  Deep-tier failure modes:
 *    - `isBot: true` → 403
 *    - `checkBotId()` throws → 403 + log (fail-closed, since
 *      false negatives here move money or destroy data)
 *
 *  Non-production short-circuit:
 *
 *  In `next dev` / vitest there's no Vercel edge serving the
 *  challenge proxy, so `checkBotId()` would emit a "Possible
 *  misconfiguration" warning on every request. The helper
 *  short-circuits to `ok:true` when `NODE_ENV !== 'production'`. */

type RequireHumanResult = { ok: true } | { ok: false; response: NextResponse };

const FORBIDDEN: RequireHumanResult = {
  ok: false,
  response: NextResponse.json({ error: "Access denied." }, { status: 403 }),
};

const IS_PROD = process.env.NODE_ENV === "production";

/** Deep-analysis BotID gate in ENFORCE mode. Use for the highest-
 *  value routes — destructive actions (account delete, admin
 *  replay) and money movement (billing checkout, account recovery).
 *  Requires Deep Analysis to be enabled at the project level
 *  (Vercel dashboard → Firewall → Rules).
 *
 *  Fail-closed posture: if `checkBotId()` itself throws (config
 *  issue, network glitch), we return 403. False positives here
 *  are recoverable — the user clicks again — but false negatives
 *  could move money or destroy data irrecoverably. */
export async function requireHumanDeep(): Promise<RequireHumanResult> {
  if (!IS_PROD) return { ok: true };
  try {
    const result = await checkBotId({
      advancedOptions: { checkLevel: "deepAnalysis" },
    });
    return result.isBot ? FORBIDDEN : { ok: true };
  } catch (err) {
    await reportServerError(err, {
      route: "(deep-tier route)",
      context: { mode: "enforce", step: "checkBotId" },
    });
    return FORBIDDEN;
  }
}
