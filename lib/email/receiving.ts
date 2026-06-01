import { Resend } from "resend";

/** Wrapper around Resend's inbound-email API. We use the official
 *  SDK here (rather than the fetch-based shim in
 *  [./resend.ts](./resend.ts) used for sends) because the
 *  receiving surface has nested sub-clients (`emails.receiving.attachments`)
 *  that are tedious to mirror by hand.
 *
 *  Resend's inbound mailbox sits behind DNS records the operator
 *  configures in the Resend dashboard — once a subdomain is pointed
 *  at Resend MX records, every message sent to it shows up in the
 *  list endpoints below. Until that's set up, the list endpoint
 *  returns an empty array (NOT an error), and the admin UI shows
 *  the "no inbound configured" empty state.
 *
 *  Env: `RESEND_API_KEY`. Helpers return `null` when it's missing
 *  so the admin route can render a configuration hint instead of
 *  crashing on a local dev box that hasn't been wired up. */

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

export type ReceivedEmailSummary = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Short snippet derived from the text body for the list view. */
  snippet: string;
  hasAttachments: boolean;
};

export type ReceivedEmailDetail = ReceivedEmailSummary & {
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
  replyTo: string[];
  cc: string[];
};

export type ReceivedAttachment = {
  id: string;
  emailId: string;
  filename: string;
  contentType: string;
  /** Bytes, when the SDK reports it. */
  size: number | null;
};

/** Possible failure modes the admin UI cares about. */
export type ReceivingError =
  | { kind: "not-configured" } // RESEND_API_KEY missing
  | { kind: "api-error"; message: string };

export type ListReceivedResult =
  | { ok: true; emails: ReceivedEmailSummary[] }
  | { ok: false; error: ReceivingError };

export async function listReceivedEmails(): Promise<ListReceivedResult> {
  const client = getResend();
  if (!client) return { ok: false, error: { kind: "not-configured" } };
  try {
    const { data, error } = await client.emails.receiving.list();
    if (error) {
      return {
        ok: false,
        error: {
          kind: "api-error",
          message: error.message ?? "Unknown Resend error",
        },
      };
    }
    const rawList = extractList(data);
    return { ok: true, emails: rawList.map(toSummary) };
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

export type GetReceivedResult =
  | { ok: true; email: ReceivedEmailDetail }
  | { ok: false; error: ReceivingError | { kind: "not-found" } };

export async function getReceivedEmail(id: string): Promise<GetReceivedResult> {
  const client = getResend();
  if (!client) return { ok: false, error: { kind: "not-configured" } };
  try {
    const { data, error } = await client.emails.receiving.get(id);
    if (error) {
      const message = error.message ?? "Unknown Resend error";
      if (/not[\s_-]?found/i.test(message)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      return { ok: false, error: { kind: "api-error", message } };
    }
    if (!data) return { ok: false, error: { kind: "not-found" } };
    return { ok: true, email: toDetail(data) };
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

export type ListAttachmentsResult =
  | { ok: true; attachments: ReceivedAttachment[] }
  | { ok: false; error: ReceivingError };

export async function listReceivedAttachments(
  emailId: string,
): Promise<ListAttachmentsResult> {
  const client = getResend();
  if (!client) return { ok: false, error: { kind: "not-configured" } };
  try {
    const { data, error } = await client.emails.receiving.attachments.list({
      emailId,
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
    const rawList = extractList(data);
    return {
      ok: true,
      attachments: rawList.map((row) => toAttachment(row, emailId)),
    };
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

/** The raw Resend list responses are shaped `{ data: [...] }` or
 *  `{ data: { data: [...] } }` depending on the version — we
 *  defensively walk either shape so a future SDK bump doesn't
 *  silently break the list view. */
function extractList(input: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(input)) {
    return input as Array<Record<string, unknown>>;
  }
  if (input && typeof input === "object") {
    const inner = (input as { data?: unknown }).data;
    if (Array.isArray(inner)) {
      return inner as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function toSummary(row: Record<string, unknown>): ReceivedEmailSummary {
  const text = readString(row.text);
  const subject = readString(row.subject) || "(no subject)";
  return {
    id: readString(row.id) || "",
    from: readString(row.from) || "(unknown sender)",
    to: readStringList(row.to),
    subject,
    createdAt:
      readString(row.created_at) ||
      readString(row.createdAt) ||
      new Date(0).toISOString(),
    snippet: makeSnippet(text),
    hasAttachments: Array.isArray(row.attachments)
      ? row.attachments.length > 0
      : Boolean(row.has_attachments),
  };
}

function toDetail(row: unknown): ReceivedEmailDetail {
  const r = (row && typeof row === "object" ? row : {}) as Record<
    string,
    unknown
  >;
  const summary = toSummary(r);
  const html = readString(r.html) || null;
  const text = readString(r.text) || null;
  const headers = readHeaders(r.headers);
  return {
    ...summary,
    html,
    text,
    headers,
    replyTo: readStringList(r.reply_to ?? r.replyTo),
    cc: readStringList(r.cc),
  };
}

function toAttachment(
  row: Record<string, unknown>,
  emailId: string,
): ReceivedAttachment {
  return {
    id: readString(row.id) || "",
    emailId,
    filename: readString(row.filename) || "(unnamed)",
    contentType:
      readString(row.content_type) ||
      readString(row.contentType) ||
      "application/octet-stream",
    size: typeof row.size === "number" ? row.size : null,
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

function readHeaders(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

function makeSnippet(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 140) return trimmed;
  return `${trimmed.slice(0, 137)}…`;
}
