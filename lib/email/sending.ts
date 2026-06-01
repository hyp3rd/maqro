import { Resend } from "resend";

/** SDK-based wrapper around Resend's outbound email API. The
 *  transactional path ([./resend.ts](./resend.ts)) uses a hand-
 *  rolled fetch for the single `POST /emails` surface it needs;
 *  the admin-driven send/retrieve/cancel surface uses the SDK so
 *  we don't have to mirror its endpoints by hand — Resend has
 *  moved the URL shape around enough (see the v2/v3 migration
 *  notes) that owning the wire format is more maintenance than
 *  it's worth here.
 *
 *  Env: `RESEND_API_KEY` is required for anything to actually
 *  hit the network. Helpers return `not-configured` instead of
 *  throwing so the admin UI can surface a config hint.
 *
 *  Why we duplicate the SDK init from `receiving.ts` rather than
 *  share a `getResend()` factory: both modules need the same
 *  null-cached singleton, but introducing a shared client makes
 *  test isolation messier (vitest's `vi.resetModules()` doesn't
 *  walk inter-module module-level caches, so a test that
 *  overrides receiving's mocks would leak into sending). One
 *  module = one cached client = predictable test boundaries. */

let cached: Resend | null | undefined;

function getResend(): Resend | null {
  if (cached !== undefined) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    cached = null;
    return null;
  }
  cached = new Resend(key);
  return cached;
}

export type SendError =
  | { kind: "not-configured" } // RESEND_API_KEY missing
  | { kind: "no-sender" } // EMAIL_FROM missing
  | { kind: "api-error"; message: string };

export type AdminSendParams = {
  to: string[];
  subject: string;
  /** Plain-text body. Required — admin replies are almost always
   *  plain-text; HTML support can be added later when we have a
   *  composer that warrants it. */
  text: string;
  /** Optional HTML body. When omitted, Resend renders the text as
   *  the only body. When provided, gmail/outlook prefer the HTML
   *  alternative. */
  html?: string;
  /** Reply-To header. Set when the operator wants replies to land
   *  somewhere other than the default `EMAIL_FROM` mailbox. */
  replyTo?: string;
  /** ISO-8601 scheduled-send time. Resend holds the message until
   *  then; we expose Cancel from the admin UI for these. */
  scheduledAt?: string;
  /** When this send is a reply to a received message, pass that
   *  inbound email's id. Surfaces as an `In-Reply-To` / `References`
   *  header on the outbound so client threading works. */
  inReplyTo?: string;
};

export type AdminSendResult =
  | { ok: true; id: string }
  | { ok: false; error: SendError };

/** Send a message via Resend. Mirrors `resend.emails.send()` but
 *  with our `{ok, error}` result shape so callers don't have to
 *  re-discriminate Resend's `{data, error}` envelope. */
export async function sendAdminEmail(
  params: AdminSendParams,
): Promise<AdminSendResult> {
  const client = getResend();
  if (!client) return { ok: false, error: { kind: "not-configured" } };
  const from = process.env.EMAIL_FROM;
  if (!from) return { ok: false, error: { kind: "no-sender" } };

  try {
    const headers: Record<string, string> = {};
    if (params.inReplyTo) {
      // RFC 5322 §3.6.4 — both headers are recommended together so
      // gmail/outlook threading works regardless of which the
      // recipient's client honours.
      headers["In-Reply-To"] = `<${params.inReplyTo}>`;
      headers["References"] = `<${params.inReplyTo}>`;
    }
    const { data, error } = await client.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      ...(params.scheduledAt ? { scheduledAt: params.scheduledAt } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    if (error) {
      return {
        ok: false,
        error: {
          kind: "api-error",
          message: error.message ?? "Unknown Resend error",
        },
      };
    }
    if (!data?.id) {
      return {
        ok: false,
        error: { kind: "api-error", message: "Resend returned no id" },
      };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "api-error",
        message: err instanceof Error ? err.message : "Resend call failed",
      },
    };
  }
}

export type OutgoingEmailStatus =
  | "scheduled"
  | "queued"
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "complained"
  | "bounced"
  | "opened"
  | "clicked"
  | "failed"
  | "canceled"
  | "unknown";

export type OutgoingEmailDetail = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  /** Resend's last-known status for this email. Mapped through a
   *  closed union so the admin UI's badge palette stays exhaustive. */
  lastStatus: OutgoingEmailStatus;
  createdAt: string;
  scheduledAt: string | null;
};

export type GetOutgoingResult =
  | { ok: true; email: OutgoingEmailDetail }
  | { ok: false; error: SendError | { kind: "not-found" } };

/** Retrieve a previously-sent email by Resend id. Used by the
 *  admin Outgoing detail page to show fresh status (delivered,
 *  bounced, opened, …) — Resend updates this row asynchronously
 *  as the recipient interacts with the message. */
export async function getOutgoingEmail(id: string): Promise<GetOutgoingResult> {
  const client = getResend();
  if (!client) return { ok: false, error: { kind: "not-configured" } };
  try {
    const { data, error } = await client.emails.get(id);
    if (error) {
      const message = error.message ?? "Unknown Resend error";
      if (/not[\s_-]?found/i.test(message)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      return { ok: false, error: { kind: "api-error", message } };
    }
    if (!data) return { ok: false, error: { kind: "not-found" } };
    return { ok: true, email: toOutgoingDetail(data) };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "api-error",
        message: err instanceof Error ? err.message : "Resend call failed",
      },
    };
  }
}

/** Cancel doesn't need EMAIL_FROM (no message body involved), so
 *  `no-sender` isn't a possible failure mode — narrow it out so
 *  the route's switch on `error.kind` stays exhaustive without
 *  the dead branch. */
export type CancelError =
  | { kind: "not-configured" }
  | { kind: "api-error"; message: string }
  | { kind: "not-found" };

export type CancelResult = { ok: true } | { ok: false; error: CancelError };

/** Cancel a scheduled (not-yet-sent) email. Resend only honours
 *  this while the message is in the `scheduled` state — once it's
 *  in `queued` or `sent`, cancel is a no-op (Resend returns an
 *  error, which we surface as `api-error` so the operator sees
 *  why their click didn't change anything). */
export async function cancelOutgoingEmail(id: string): Promise<CancelResult> {
  const client = getResend();
  if (!client) return { ok: false, error: { kind: "not-configured" } };
  try {
    const { error } = await client.emails.cancel(id);
    if (error) {
      const message = error.message ?? "Unknown Resend error";
      if (/not[\s_-]?found/i.test(message)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      return { ok: false, error: { kind: "api-error", message } };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "api-error",
        message: err instanceof Error ? err.message : "Resend call failed",
      },
    };
  }
}

const KNOWN_STATUSES: ReadonlySet<OutgoingEmailStatus> = new Set([
  "scheduled",
  "queued",
  "sent",
  "delivered",
  "delivery_delayed",
  "complained",
  "bounced",
  "opened",
  "clicked",
  "failed",
  "canceled",
]);

function toOutgoingDetail(row: unknown): OutgoingEmailDetail {
  const r = (row && typeof row === "object" ? row : {}) as Record<
    string,
    unknown
  >;
  const rawStatus = readString(r.last_event) || readString(r.status);
  const lastStatus: OutgoingEmailStatus = KNOWN_STATUSES.has(
    rawStatus as OutgoingEmailStatus,
  )
    ? (rawStatus as OutgoingEmailStatus)
    : "unknown";
  return {
    id: readString(r.id),
    from: readString(r.from),
    to: readStringList(r.to),
    subject: readString(r.subject) || "(no subject)",
    lastStatus,
    createdAt:
      readString(r.created_at) ||
      readString(r.createdAt) ||
      new Date(0).toISOString(),
    scheduledAt:
      readString(r.scheduled_at) || readString(r.scheduledAt) || null,
  };
}

function readString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function readStringList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string");
  }
  if (typeof v === "string") return [v];
  return [];
}
