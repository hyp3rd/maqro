import { escapeHtml, notifyAdmins } from "@/lib/admin-notify";
import { getAppUrl } from "@/lib/app-url";
import { verifyResendWebhook } from "@/lib/email/webhook-verify";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ResendEvent = {
  type?: string;
  data?: { from?: string; to?: string[]; subject?: string };
};

/** Resend webhook receiver. On `email.received` (a new inbound message) it
 *  pushes + emails every admin; other events are acked and ignored. Configure in
 *  Resend: a webhook pointing at {app-url}/api/webhooks/resend subscribed to the
 *  email.received event, with its signing secret in RESEND_WEBHOOK_SECRET. */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (!verifyResendWebhook(rawBody, request.headers, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: event.type ?? null });
  }

  const config = getSupabaseSecretConfig();
  if (config) {
    const admin = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const from = event.data?.from ?? "someone";
    const subject = event.data?.subject?.trim() || "(no subject)";
    const inboxUrl = `${getAppUrl()}/admin/inbox`;
    await notifyAdmins(admin, {
      title: "New message in your inbox",
      body: `From ${from}: ${subject}`,
      url: "/admin/inbox",
      emailHtml:
        `<p>A new message arrived in your admin inbox.</p>` +
        `<p><strong>From:</strong> ${escapeHtml(from)}<br/>` +
        `<strong>Subject:</strong> ${escapeHtml(subject)}</p>` +
        `<p><a href="${inboxUrl}">Open the inbox</a></p>`,
    });
  }

  // Always 200 so Resend treats it as delivered and doesn't retry.
  return NextResponse.json({ ok: true });
}
