/** Calendar-day arithmetic on `YYYY-MM-DD` keys — the ONE canonical
 *  implementation (this helper used to be hand-copied across eight files).
 *
 *  Component-based via `setDate`, so the key is treated as a calendar
 *  marker, not a timestamp: adding 1 day across a spring-forward /
 *  fall-back boundary yields exactly the next calendar day, never 23 or
 *  25 hours later. Negative `days` moves backwards. A malformed key is
 *  returned unchanged. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
