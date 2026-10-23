/** Number display shared by the readouts. Grouping and the decimal mark
 *  follow the active app locale (`useLocale()` from next-intl, resolved in
 *  [locale.ts](./locale.ts)), never a hard-coded one: "1,234" means
 *  one thousand in English but reads as 1.234 to an Italian. */

/** The precisions a readout shows: whole figures, or one or two decimals.
 *  A closed set rather than any number, because `Intl.NumberFormat` throws
 *  a RangeError for fraction digits outside 0-100 (or NaN), which would
 *  crash the render of whatever readout passed one.
 *  https://tc39.es/ecma402/#sec-setnumberformatdigitoptions */
export type ReadoutDecimals = 0 | 1 | 2;

/** What a readout shows in place of a value that is not a finite number,
 *  instead of Intl's "NaN" or "∞". */
export const NO_FIGURE = "—";

/** `n` rounded to `decimals` fraction digits (half up). The readouts round
 *  with this before they format or compare, so what they say about a value
 *  (over or under a target, by how much) matches the figures on screen. */
export function roundTo(n: number, decimals: ReadoutDecimals): number {
  const factor = 10 ** decimals;
  const scaled = n * factor;
  // Scaling overflows to Infinity only far past 2^53, where a double has no
  // fraction digits left to round; NaN and ±Infinity stay what they are.
  return Number.isFinite(scaled) ? Math.round(scaled) / factor : n;
}

/** `n` rounded to exactly `decimals` fraction digits, with the locale's
 *  grouping and decimal mark: `formatNumber(12345.6, "en")` is "12,346",
 *  `formatNumber(12345.6, "it")` is "12.346". A value that is not a finite
 *  number reads as `NO_FIGURE`. */
export function formatNumber(
  n: number,
  locale: string,
  decimals: ReadoutDecimals = 0,
): string {
  if (!Number.isFinite(n)) return NO_FIGURE;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(roundTo(n, decimals));
}
