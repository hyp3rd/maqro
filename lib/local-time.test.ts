import { describe, expect, it } from "vitest";
import {
  localDateInTimeZone,
  localHourInTimeZone,
  shouldSendReminder,
} from "./local-time";

// 2026-05-19T18:00:00Z — Tuesday afternoon UTC. Picked so the
// hour mapping is unambiguous: it's 20:00 in Berlin (UTC+2 DST),
// 11:00 in Los Angeles (UTC-7 DST), and still 2026-05-19 in both.
const SAMPLE = new Date("2026-05-19T18:00:00Z");

describe("localHourInTimeZone", () => {
  it("returns the UTC hour when timeZone is UTC", () => {
    expect(localHourInTimeZone(SAMPLE, "UTC")).toBe(18);
  });

  it("returns the local hour for Europe/Berlin (DST in May → UTC+2)", () => {
    expect(localHourInTimeZone(SAMPLE, "Europe/Berlin")).toBe(20);
  });

  it("returns the local hour for America/Los_Angeles (DST in May → UTC-7)", () => {
    expect(localHourInTimeZone(SAMPLE, "America/Los_Angeles")).toBe(11);
  });

  it("returns the local hour for Asia/Tokyo (no DST, UTC+9)", () => {
    // 18:00 UTC → 03:00 next day in Tokyo. The hour is 3.
    expect(localHourInTimeZone(SAMPLE, "Asia/Tokyo")).toBe(3);
  });

  it("falls back to UTC for an invalid timezone string", () => {
    expect(localHourInTimeZone(SAMPLE, "Not/A/Zone")).toBe(18);
  });
});

describe("localDateInTimeZone", () => {
  it("returns the UTC date when timeZone is UTC", () => {
    expect(localDateInTimeZone(SAMPLE, "UTC")).toBe("2026-05-19");
  });

  it("returns the same calendar date for Europe/Berlin at 18 UTC", () => {
    // 20:00 Berlin → still 2026-05-19.
    expect(localDateInTimeZone(SAMPLE, "Europe/Berlin")).toBe("2026-05-19");
  });

  it("rolls forward to the next day for Asia/Tokyo", () => {
    // 03:00 next day → 2026-05-20.
    expect(localDateInTimeZone(SAMPLE, "Asia/Tokyo")).toBe("2026-05-20");
  });

  it("falls back to UTC date for an invalid timezone", () => {
    expect(localDateInTimeZone(SAMPLE, "Not/A/Zone")).toBe("2026-05-19");
  });
});

describe("shouldSendReminder", () => {
  it("sends when local hour matches and no send today yet", () => {
    const result = shouldSendReminder({
      now: SAMPLE,
      timeZone: "Europe/Berlin",
      reminderHour: 20,
      lastSentDate: null,
    });
    expect(result.send).toBe(true);
    expect(result.localDate).toBe("2026-05-19");
  });

  it("skips when local hour does not match", () => {
    const result = shouldSendReminder({
      now: SAMPLE,
      timeZone: "Europe/Berlin",
      reminderHour: 18,
      lastSentDate: null,
    });
    expect(result.send).toBe(false);
  });

  it("skips when we already sent on this local date", () => {
    const result = shouldSendReminder({
      now: SAMPLE,
      timeZone: "Europe/Berlin",
      reminderHour: 20,
      lastSentDate: "2026-05-19",
    });
    expect(result.send).toBe(false);
  });

  it("sends again on a new local day", () => {
    const result = shouldSendReminder({
      now: SAMPLE,
      timeZone: "Europe/Berlin",
      reminderHour: 20,
      lastSentDate: "2026-05-18",
    });
    expect(result.send).toBe(true);
  });

  it("treats null timeZone as UTC", () => {
    const result = shouldSendReminder({
      now: SAMPLE,
      timeZone: null,
      reminderHour: 18,
      lastSentDate: null,
    });
    expect(result.send).toBe(true);
    expect(result.localDate).toBe("2026-05-19");
  });

  it("respects idempotency across hour preference changes", () => {
    // A user who already received their reminder at 18:00 local
    // and then changes their preference to 20:00 local should
    // NOT receive a second one — the idempotency check uses the
    // local date, not the hour.
    const localDateMatch = shouldSendReminder({
      now: SAMPLE,
      timeZone: "Europe/Berlin",
      reminderHour: 20,
      lastSentDate: "2026-05-19",
    });
    expect(localDateMatch.send).toBe(false);
  });
});
