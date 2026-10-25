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

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a real calendar `YYYY-MM-DD` key: the right shape AND a
 *  day that exists ("2026-02-30" and "2026-13-01" are not). Takes `unknown`
 *  so it can guard values read back from synced or imported blobs, whose
 *  date fields no database constraint checks. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_KEY.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/** The calendar day a `YYYY-MM-DD` key names, as LOCAL midnight: the `Date`
 *  to hand `toLocaleDateString` when labelling a key. `new Date(key)` parses
 *  a date-only string as UTC midnight, which west of UTC is the evening
 *  before, so its label names the wrong day. Null for anything that is not
 *  a real calendar key. */
export function localDateOfKey(key: string): Date | null {
  if (!isDateKey(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
