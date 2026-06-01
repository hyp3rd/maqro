/** Fetch-based Resend wrapper. Avoiding the `resend` npm package
 *  keeps the dep tree minimal — the REST surface we need is one
 *  endpoint (`POST /emails`) with a JSON body.
 *
 *  Env gating: `RESEND_API_KEY` is required for any actual sends.
 *  `EMAIL_FROM` is the sender address (must be a verified Resend
 *  domain). When either is missing, `sendEmail` returns
 *  `{ skipped: true, reason }` instead of throwing — the cron
 *  routes log this and treat it as a no-op send. That way a
 *  partially-configured deployment doesn't 500 the cron; it just
 *  doesn't email anyone until both env vars are set. */

const RESEND_API_URL = "https://api.resend.com/emails";

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative for clients that strip HTML. Optional —
   *  good email clients accept HTML-only, but providing text means
   *  CLI mail clients and spam filters that score on text-presence
   *  see the message correctly. */
  text?: string;
  /** Reply-To header. Useful for transactional inboxes (support,
   *  recovery) where the sender is a generic from-address but the
   *  responder needs to reach the actual user with one click. */
  replyTo?: string;
};

export type SendResult =
  | { ok: true; id: string }
  | { skipped: true; reason: string }
  | { ok: false; error: string };

/** Send a single email via Resend's REST API. */
export async function sendEmail(params: SendEmailParams): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey) return { skipped: true, reason: "RESEND_API_KEY not set" };
  if (!from) return { skipped: true, reason: "EMAIL_FROM not set" };

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Resend ${res.status}: ${body || res.statusText}`,
      };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id ?? "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Resend request failed",
    };
  }
}
