import { isLikelyEmail } from "@/lib/account/backup-email";
import { parseBody } from "@/lib/api/parse-body";
import { sendAdminEmail } from "@/lib/email/sending";
import { reportServerError } from "@/lib/error-reporter";
import { requireAdmin, writeAuditLog } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

/** POST /api/admin/inbox/send - admin-issued outbound email.
 *
 *  Two flows funnel here:
 *    1. Compose a new message (operator-initiated outreach).
 *    2. Reply to a received inbound - same shape, plus an
 *       `inReplyTo` field that becomes the In-Reply-To /
 *       References header on the outbound for client-side
 *       threading.
 *
 *  Body validation is strict so a stale or hand-rolled client
 *  can't drop a half-formed send onto the queue:
 *    - `to`: non-empty array of strings; each must match a
 *      conservative email shape (the same linear validator the
 *      signup guard uses).
 *    - `subject`: non-empty trimmed string.
 *    - `text`: non-empty trimmed string (plain-text body is the
 *      canonical content). HTML is optional.
 *    - `scheduledAt`: ISO-8601 string in the future (max 30 days
 *      out - Resend's own cap, mirrored here so we 400 early).
 *
 *  Successful sends write a row to `admin_sent_emails` so the
 *  /admin/inbox/outgoing list can render them without a
 *  round-trip per email. Failures DON'T persist - a row with no
 *  Resend id is useless and would confuse the cancel surface. */

export const runtime = "nodejs";

const MAX_RECIPIENTS = 25;
const MAX_SCHEDULE_DAYS = 30;

/** Schema gates shape + cardinality up front (array length, string
 *  shapes, optional fields). Per-entry email validity stays inline
 *  because `isLikelyEmail` returns the recipient string in the
 *  error message, which the admin UI surfaces verbatim. */
const BodySchema = z.object({
  to: z.array(z.string()).min(1).max(MAX_RECIPIENTS),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
  replyTo: z.string().optional(),
  scheduledAt: z.string().optional(),
  inReplyTo: z.string().optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const to: string[] = [];
  for (const item of parsed.data.to) {
    const trimmed = item.trim();
    if (!isLikelyEmail(trimmed)) {
      return NextResponse.json(
        { error: `Invalid email address: ${item}` },
        { status: 400 },
      );
    }
    to.push(trimmed);
  }

  const subject = parsed.data.subject.trim();
  if (!subject) {
    return NextResponse.json(
      { error: "`subject` is required." },
      { status: 400 },
    );
  }
  const text = parsed.data.text.trim();
  if (!text) {
    return NextResponse.json(
      { error: "`text` body is required." },
      { status: 400 },
    );
  }
  const html =
    parsed.data.html && parsed.data.html.trim().length > 0
      ? parsed.data.html
      : undefined;
  const replyTo = parsed.data.replyTo?.trim() || undefined;
  const inReplyTo = parsed.data.inReplyTo?.trim() || undefined;

  let scheduledAt: string | undefined;
  if (parsed.data.scheduledAt) {
    const t = Date.parse(parsed.data.scheduledAt);
    if (Number.isNaN(t)) {
      return NextResponse.json(
        { error: "`scheduledAt` is not a valid date." },
        { status: 400 },
      );
    }
    const now = Date.now();
    if (t <= now) {
      return NextResponse.json(
        { error: "`scheduledAt` must be in the future." },
        { status: 400 },
      );
    }
    if (t - now > MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        {
          error: `\`scheduledAt\` is too far out (max ${MAX_SCHEDULE_DAYS} days).`,
        },
        { status: 400 },
      );
    }
    scheduledAt = new Date(t).toISOString();
  }

  const result = await sendAdminEmail({
    to,
    subject,
    text,
    html,
    replyTo,
    scheduledAt,
    inReplyTo,
  });
  if (!result.ok) {
    if (result.error.kind === "not-configured") {
      return NextResponse.json(
        { error: "Resend isn't configured (RESEND_API_KEY missing)." },
        { status: 503 },
      );
    }
    if (result.error.kind === "no-sender") {
      return NextResponse.json(
        { error: "EMAIL_FROM is not configured." },
        { status: 503 },
      );
    }
    await reportServerError(new Error(result.error.message), {
      route: "/api/admin/inbox/send",
      context: { to, subject },
    });
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }

  // Persist the row so /admin/inbox/outgoing can render it. Best-
  // effort - a write failure here doesn't undo the actual send,
  // so we report and return success with a flag instead of 500ing.
  const config = getSupabaseSecretConfig();
  let persisted = false;
  if (config) {
    const admin = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: insErr } = await admin
      .from("admin_sent_emails")
      .insert({
        id: result.id,
        admin_user_id: guard.userId,
        recipients: to,
        subject,
        in_reply_to: inReplyTo ?? null,
        scheduled_at: scheduledAt ?? null,
      });
    if (insErr) {
      await reportServerError(insErr, {
        route: "/api/admin/inbox/send",
        context: { resendId: result.id, step: "persist" },
      });
    } else {
      persisted = true;
    }
  }

  await writeAuditLog({
    adminUserId: guard.userId,
    action: inReplyTo ? "inbox.reply" : "inbox.send",
    payload: {
      resendId: result.id,
      to,
      subject,
      scheduledAt: scheduledAt ?? null,
      inReplyTo: inReplyTo ?? null,
      persisted,
    },
  });

  return NextResponse.json({
    ok: true,
    id: result.id,
    persisted,
    scheduledAt: scheduledAt ?? null,
  });
}
