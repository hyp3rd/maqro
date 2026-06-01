import { parseBody } from "@/lib/api/parse-body";
import { getAppUrl } from "@/lib/app-url";
import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getInstacartConfig } from "@/lib/shopping/instacart";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 30;
const MAX_ITEMS = 100;

const BodySchema = z.object({
  title: z.string().min(1).max(200),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: z.number().finite().positive().optional(),
        unit: z.string().max(40).optional(),
        displayText: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(MAX_ITEMS),
});

/** Create a pre-filled Instacart shopping-list page from the user's
 *  shopping list and return its URL. Instacart's Developer Platform is
 *  the one provider with a public cart API; the others are search
 *  deep-links built client-side.
 *
 *  Auth-gated + AAL2-gated (the `require-aal2-gate` lint rule enforces
 *  this). The API key is server-only; nothing about the user is stored.
 *  503 when the integration isn't configured so the client can hide the
 *  button. */
export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const gate = await assertAal2(
    supabase,
    await trustedDeviceOption(supabase, user.id),
  );
  if (!gate.ok) return gate.response;

  const config = getInstacartConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Instacart isn't configured on this deployment." },
      { status: 503 },
    );
  }

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const payload = {
    title: body.title,
    link_type: "shopping_list",
    line_items: body.items.map((i) => ({
      name: i.name,
      ...(i.quantity !== undefined ? { quantity: i.quantity } : {}),
      ...(i.unit ? { unit: i.unit } : {}),
      ...(i.displayText ? { display_text: i.displayText } : {}),
    })),
    landing_page_configuration: {
      partner_linkback_url: `${getAppUrl()}/app?view=pantry`,
      enable_pantry_items: true,
    },
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${config.base}/idp/v1/products/products_link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach Instacart. Try again shortly." },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    // Don't leak the upstream body (may echo the bearer context); log
    // server-side, return a clean status to the client.
    console.error(
      `[instacart-cart] products_link ${upstream.status} ${upstream.statusText}`,
    );
    return NextResponse.json(
      { error: "Instacart rejected the request." },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as { products_link_url?: unknown };
  const url =
    typeof data.products_link_url === "string" ? data.products_link_url : null;
  if (!url) {
    return NextResponse.json(
      { error: "Instacart returned no link." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url });
}
