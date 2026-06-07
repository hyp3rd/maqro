import { sendEmail } from "@/lib/email/resend";
import { sendPush } from "@/lib/push/send";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal HTML escape for interpolating untrusted text (a sender address, a
 *  subject line) into a notification email body. */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

/** Notify every admin (profiles.role = 'admin') via web push AND email.
 *  Best-effort: per-channel failures are swallowed so one dead subscription or a
 *  skipped email doesn't block the rest. `admin` is a service-role client. */
export async function notifyAdmins(
  admin: SupabaseClient,
  msg: { title: string; body: string; url?: string; emailHtml?: string },
): Promise<void> {
  const { data: adminRows } = await admin
    .from("profiles")
    .select("user_id")
    .eq("role", "admin");
  const ids = (adminRows ?? []).map((r) => r.user_id as string);
  if (ids.length === 0) return;

  // Push to every admin device.
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("user_id", ids);
  await Promise.all(
    (subs ?? []).map((s) =>
      sendPush(
        {
          endpoint: s.endpoint as string,
          p256dh: s.p256dh as string,
          auth: s.auth as string,
        },
        { title: msg.title, body: msg.body, url: msg.url, tag: "admin-inbox" },
      ).catch(() => undefined),
    ),
  );

  // Email every admin (look up the address via the service-role auth admin API).
  const html = msg.emailHtml ?? `<p>${escapeHtml(msg.body)}</p>`;
  await Promise.all(
    ids.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      const email = data.user?.email;
      if (!email) return;
      await sendEmail({
        to: email,
        subject: msg.title,
        html,
        text: msg.body,
      }).catch(() => undefined);
    }),
  );
}
