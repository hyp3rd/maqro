/** Number display shared by the readouts. Grouping and the decimal mark
 *  follow the active app locale (`useLocale()` from next-intl, resolved in
 *  [locale.ts](./locale.ts)), never a hard-coded one: "1,234" means
 *  one thousand in English but reads as 1.234 to an Italian. */

/** `n` rounded to `decimals` fraction digits (half up). The readouts round
 *  with this before they format or compare, so what they say about a value
 *  (over or under a target, by how much) matches the figures on screen. */
export function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** `n` rounded to exactly `decimals` fraction digits, with the locale's
 *  grouping and decimal mark: `formatNumber(12345.6, "en")` is "12,346",
 *  `formatNumber(12345.6, "it")` is "12.346". */
export function formatNumber(n: number, locale: string, decimals = 0): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(roundTo(n, decimals));
}
