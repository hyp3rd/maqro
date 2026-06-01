import { assertAal2 } from "@/lib/auth/mfa-required";
import { trustedDeviceOption } from "@/lib/auth/trusted-device";
import { getStripe } from "@/lib/billing/stripe";
import { getSupabaseServer } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

/** GET /api/billing/invoices — the caller's invoice history,
 *  scoped to their Stripe customer. Returns the columns the
 *  Settings → Billing UI needs: id, number, created, amount paid,
 *  status, plus the two Stripe-hosted links that drive the
 *  per-row actions (open the hosted invoice page, download the
 *  PDF). PDF generation is deferred to Stripe — we don't render
 *  PDFs ourselves.
 *
 *  Pagination is via Stripe cursor (`starting_after`), surfaced
 *  as `cursor` in the query string. The Settings UI loads the
 *  first page on mount and exposes "Load more" while
 *  `hasMore=true`. Default page size 10 — invoice rows are
 *  visually heavy and the user is mostly looking for the most
 *  recent one anyway.
 *
 *  Status filter (`?status=`) constrains rows to a single Stripe
 *  invoice status — `paid` is the common filter ("just show me
 *  successful charges"), `open` surfaces in-flight or past-due
 *  invoices for attention. `all` (default) skips the filter.
 *  `draft` is always filtered out regardless (drafts are Stripe
 *  internal state, not user-facing).
 *
 *  Auth: cookie-bound server client. We never look up a customer
 *  by email or any other client-supplied key. */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** Statuses the UI can filter on. `all` is the implicit default
 *  (no `.eq()`-style narrowing). `draft` isn't in this set
 *  intentionally — drafts are filtered out regardless. */
const ALLOWED_STATUSES = new Set([
  "all",
  "paid",
  "open",
  "void",
  "uncollectible",
]);

type InvoiceView = {
  id: string;
  /** Stripe's human-readable invoice number (e.g. "MAQRO-0001").
   *  Null for invoices that haven't been finalized yet (drafts,
   *  upcoming previews) — we filter those out before returning. */
  number: string | null;
  /** Unix-seconds. UI formats. */
  created: number;
  /** Cents in the invoice's currency. */
  amountPaid: number;
  /** ISO 4217 lowercase ("usd", "eur"). */
  currency: string;
  status: Stripe.Invoice.Status | null;
  /** Stripe-hosted invoice page. Always present on finalized
   *  invoices; useful for "View" actions. */
  hostedInvoiceUrl: string | null;
  /** PDF download. Same lifecycle as hostedInvoiceUrl. */
  invoicePdf: string | null;
};

function mapInvoice(inv: Stripe.Invoice): InvoiceView {
  return {
    id: inv.id ?? "",
    number: inv.number,
    created: inv.created,
    amountPaid: inv.amount_paid,
    currency: inv.currency,
    status: inv.status,
    // Stripe types these as `string | null | undefined` (undefined
    // when the field hasn't been expanded yet). Coerce to null so
    // the API surface is a clean `string | null` for the client.
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured on this deployment." },
      { status: 503 },
    );
  }
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const customerId = profile?.stripe_customer_id as string | undefined;
  if (!customerId) {
    // No Stripe customer means no invoices to show — return an
    // empty list rather than 404 so the Settings UI can render
    // the empty state without an error branch.
    return NextResponse.json({ rows: [], hasMore: false, nextCursor: null });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const statusParam = url.searchParams.get("status") ?? "all";
  // Strict allowlist — silently fall back to "all" rather than
  // erroring, since the filter is non-essential UI affordance.
  const status = ALLOWED_STATUSES.has(statusParam) ? statusParam : "all";
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT))),
  );

  const page = await stripe.invoices.list({
    customer: customerId,
    limit,
    ...(cursor ? { starting_after: cursor } : null),
    // Stripe accepts `status` directly on the list params; passing
    // it server-side beats fetching the full page and filtering in
    // memory (which would break pagination — `has_more` reflects
    // the unfiltered slice).
    ...(status !== "all" ? { status: status as Stripe.Invoice.Status } : null),
  });

  const rows = page.data
    // Filter out drafts — they're internal state, not user-
    // facing invoices. Same reason the Stripe Portal hides them.
    // Defensive: kept in case Stripe ever returns drafts when no
    // status filter is in play.
    .filter((inv) => inv.status !== "draft")
    .map(mapInvoice);
  // Stripe's `has_more` is over the WHOLE list including drafts,
  // so it stays accurate even if we filtered some rows out.
  const lastId = page.data[page.data.length - 1]?.id ?? null;

  return NextResponse.json({
    rows,
    hasMore: page.has_more,
    nextCursor: page.has_more ? lastId : null,
    status,
  });
}
