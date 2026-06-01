/** Server-only Instacart Developer Platform config. Returns `null` when
 *  `INSTACART_API_KEY` isn't set so the cart route can respond with a
 *  clean 503 and the client hides the "Open in Instacart" button (the
 *  search hand-off + copy still work). Never imported from a
 *  `"use client"` module — the API key must never reach the browser.
 *
 *  Base host: prod by default; set `INSTACART_API_BASE` to the dev host
 *  (`https://connect.dev.instacart.tools`) for testing against the
 *  sandbox. Docs:
 *  https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page/ */
const PROD_BASE = "https://connect.instacart.com";

export function getInstacartConfig(): { apiKey: string; base: string } | null {
  const apiKey = process.env.INSTACART_API_KEY;
  if (!apiKey) return null;
  const base = (process.env.INSTACART_API_BASE || PROD_BASE).replace(
    /\/+$/,
    "",
  );
  return { apiKey, base };
}
