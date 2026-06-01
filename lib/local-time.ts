/** Local time-of-day helpers for the timezone-aware daily reminder
 *  cron. Browser & server both have `Intl.DateTimeFormat` with full
 *  IANA-timezone support, so no third-party tz library needed.
 *
 *  The cron route uses these to answer two questions per user:
 *    1. "What's the user's local hour-of-day right now?"
 *       → `localHourInTimeZone(now, "Europe/Berlin") === 18`
 *    2. "What's the user's local YYYY-MM-DD right now?"
 *       → `localDateInTimeZone(now, "Europe/Berlin") === "2026-05-19"`
 *
 *  Idempotency comparison is then a plain date-string equality:
 *  if `last_reminder_sent_date === local_today`, skip.
 *
 *  Invalid timezone names fall back to UTC silently — we don't want
 *  a typo in user prefs to crash the cron for all users. */

/** Returns the hour-of-day (0–23) for `now` rendered in `timeZone`.
 *  Falls back to UTC hour if `timeZone` is unparseable. */
export function localHourInTimeZone(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour");
    if (!hourPart) return now.getUTCHours();
    const hour = Number.parseInt(hourPart.value, 10);
    return Number.isFinite(hour) ? hour : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/** Returns the local `YYYY-MM-DD` for `now` rendered in `timeZone`.
 *  Falls back to UTC date if `timeZone` is unparseable. */
export function localDateInTimeZone(now: Date, timeZone: string): string {
  try {
    // `sv-SE` (Swedish) formats dates as `YYYY-MM-DD` natively —
    // saves us assembling parts manually and avoids the locale
    // edge cases of "en-US" (which is M/D/Y by default).
    return new Intl.DateTimeFormat("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(now);
  } catch {
    const y = now.getUTCFullYear();
    const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = now.getUTCDate().toString().padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

/** Decision for the cron: given the user's preferences, the cron's
 *  current `now`, and the date of their last send, should we send?
 *
 *  Sends if:
 *    - The local hour matches the user's preferred reminder hour.
 *    - We haven't already sent on this local date.
 *
 *  Returns `{ send: boolean; localDate: string }` so the caller can
 *  persist `localDate` after a successful send. */
export function shouldSendReminder(opts: {
  now: Date;
  timeZone: string | null | undefined;
  reminderHour: number;
  lastSentDate: string | null;
}): { send: boolean; localDate: string } {
  // NULL timezone — user hasn't set a preference yet. Treat as UTC
  // so the historical behavior is preserved (the original cron
  // fired at 18:00 UTC).
  const tz = opts.timeZone ?? "UTC";
  const localHour = localHourInTimeZone(opts.now, tz);
  const localDate = localDateInTimeZone(opts.now, tz);

  if (localHour !== opts.reminderHour) return { send: false, localDate };
  if (opts.lastSentDate === localDate) return { send: false, localDate };
  return { send: true, localDate };
}
