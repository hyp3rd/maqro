import type { Food } from "@/components/macro/types";
import { hitToFood, type OFFHit } from "@/lib/ai/off-search";
import { NextResponse } from "next/server";

/** Same-origin proxy for Open Food Facts' single-product lookup
 *  endpoint: `https://world.openfoodfacts.org/api/v0/product/<code>.json`.
 *  The browser can't reach the upstream directly (no CORS); we wrap it
 *  here with sanitization, a 5 s timeout, and the same Food-shape
 *  normalizer the AI search uses so the rest of the app treats a
 *  scanned product identically to a typed search result. */

const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v0/product";
const TIMEOUT_MS = 5_000;
const USER_AGENT =
  "macro-calculator/0.1 (https://github.com/hyp3rd/macro-calculator)";

type OffProductResponse = {
  /** OFF returns `1` when the barcode is recognized, `0` otherwise. */
  status?: 0 | 1;
  product?: OFFHit;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code: raw } = await ctx.params;
  // Digit-strip then validate length. We don't reject the original raw
  // for containing non-digits — the URL is encoded by encodeURIComponent
  // and we re-build the upstream URL from `code` only, so path traversal
  // can't slip through.
  const code = raw.replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) {
    return NextResponse.json(
      { error: "Invalid barcode format." },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OFF_PRODUCT_URL}/${code}.json`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
      next: { revalidate: 60 },
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || controller.signal.aborted)
    ) {
      return NextResponse.json(
        { error: "Open Food Facts lookup timed out after 5s" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        error: `Couldn't reach Open Food Facts: ${err instanceof Error ? err.message : "network error"}`,
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Open Food Facts lookup failed (HTTP ${res.status})` },
      { status: 502 },
    );
  }

  let data: OffProductResponse;
  try {
    data = (await res.json()) as OffProductResponse;
  } catch {
    return NextResponse.json(
      { error: "Malformed response from Open Food Facts." },
      { status: 502 },
    );
  }

  if (data.status !== 1 || !data.product) {
    return NextResponse.json(
      {
        error: `No product found for barcode ${code} in the Open Food Facts database.`,
      },
      { status: 404 },
    );
  }

  // OFF sometimes omits a `code` on the product object — fall back to
  // the URL param so the local id stays stable.
  const food: Food | null = hitToFood({
    ...data.product,
    code: data.product.code ?? code,
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
