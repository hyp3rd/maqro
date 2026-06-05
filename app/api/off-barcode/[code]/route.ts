import type { Food } from "@/components/macro/types";
import { fetchOffProductResult, hitToFood } from "@/lib/ai/off-search";
import { NextResponse } from "next/server";

/** Same-origin proxy for Open Food Facts' single-product lookup endpoint:
 *  `https://world.openfoodfacts.org/api/v0/product/<code>.json`. The browser
 *  can't reach the upstream directly (no CORS); the fetch + the shared
 *  cross-instance cache live in `fetchOffProductResult` (so a barcode scanned
 *  here and one enriched by the cron share a cache entry), and the same
 *  `hitToFood` normalizer the AI search uses keeps a scanned product identical
 *  to a typed search result. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code: raw } = await ctx.params;
  // Digit-strip then validate length before hitting the shared helper. The
  // upstream URL is rebuilt from digits only, so path traversal can't slip in.
  const code = raw.replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) {
    return NextResponse.json(
      { error: "Invalid barcode format." },
      { status: 400 },
    );
  }

  const result = await fetchOffProductResult(code);
  if (result.status === "timeout") {
    return NextResponse.json(
      { error: "Open Food Facts lookup timed out after 5s" },
      { status: 504 },
    );
  }
  if (result.status === "error") {
    return NextResponse.json(
      { error: "Couldn't reach Open Food Facts." },
      { status: 502 },
    );
  }
  if (result.status === "not_found") {
    return NextResponse.json(
      {
        error: `No product found for barcode ${code} in the Open Food Facts database.`,
      },
      { status: 404 },
    );
  }

  // OFF sometimes omits a `code` on the product object — fall back to the URL
  // param so the local id stays stable.
  const food: Food | null = hitToFood({
    ...result.product,
    code: result.product.code ?? code,
  });
  if (!food) {
    return NextResponse.json(
      {
        error: `Open Food Facts has this product but no usable macros (missing protein/carbs/fat). Add it manually.`,
      },
      { status: 422 },
    );
  }
  return NextResponse.json({ food });
}
