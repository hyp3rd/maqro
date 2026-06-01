import { parseBody } from "@/lib/api/parse-body";
import { getAppUrl } from "@/lib/app-url";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { sendPush } from "@/lib/push/send";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const BodySchema = z.object({
  itemName: z.string().min(1).max(200),
  quantity: z.number().finite().nonnegative(),
  unit: z.string().max(40),
});

/** Fire a Web Push to all of the caller's registered devices when a
 *  pantry item has just crossed the low-stock threshold. The in-app
 *  notification (synced `pantryNotifications` store) is the source of
 *  truth and is written by the client regardless; this push is the
 *  best-effort "nudge the user who isn't currently looking at the app"
 *  layer, mirroring the daily-reminder cron's send loop.
 *
 *  Posted via `clientFetch` so the MFA / trusted-device flow applies —
 *  hence the `assertAal2` gate that the `require-aal2-gate` lint rule
 *  enforces on every authenticated mutating route. */
export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase isn't configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { itemName, quantity, unit } = parsed.data;

  // Owner-scoped read — RLS pins this to the caller's rows.
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", user.id);

  const appUrl = getAppUrl();
  const left = `${quantity} ${unit}`.trim();
  let sent = 0;
  for (const sub of subs ?? []) {
    const result = await sendPush(
      {
        endpoint: sub.endpoint as string,
        p256dh: sub.p256dh as string,
        auth: sub.auth as string,
      },
      {
        title: `${itemName} is running low`,
        body: `Only ${left} left in your pantry.`,
        url: `${appUrl}/app?view=pantry`,
        // Per-item tag so repeated alerts for the same item collapse
        // into one bubble rather than stacking.
        tag: `pantry-low:${itemName}`,
      },
    );
    if (result.ok) {
      sent++;
    } else if (result.gone) {
      // Dead subscription — reap so we stop paying for it.
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
