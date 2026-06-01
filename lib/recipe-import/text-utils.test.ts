import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  formatIsoDuration,
  parseServingsCount,
  parseTotalTimeToMinutes,
} from "./text-utils";

describe("decodeHtmlEntities", () => {
  it("decodes the common named entities recipe sites leak", () => {
    expect(decodeHtmlEntities("Salt &amp; pepper")).toBe("Salt & pepper");
    expect(decodeHtmlEntities("&quot;done&quot;")).toBe('"done"');
    expect(decodeHtmlEntities("over &mdash; out")).toBe("over — out");
    expect(decodeHtmlEntities("café&nbsp;au lait")).toBe("café au lait");
  });

  it("decodes the fraction entities ingredient quantities use", () => {
    // The bug that prompted this code path: `&frac34;` slipping
    // through the JSON-LD parser unchanged.
    expect(decodeHtmlEntities("Tomato purée &frac34; cup")).toBe(
      "Tomato purée ¾ cup",
    );
    expect(decodeHtmlEntities("&frac12; tsp salt")).toBe("½ tsp salt");
    expect(decodeHtmlEntities("&frac13; cup oil")).toBe("⅓ cup oil");
  });

  it("decodes decimal numeric references", () => {
    expect(decodeHtmlEntities("&#8211;&#8212;&#8230;")).toBe("–—…");
    expect(decodeHtmlEntities("Caf&#233;")).toBe("Café");
  });

  it("decodes hex numeric references (with both upper and lowercase x)", () => {
    expect(decodeHtmlEntities("&#x2014;&#X2013;&#x2026;")).toBe("—–…");
  });

  it("is case-insensitive on named entities", () => {
    // &AMP; → "&", &Quot; → '"', &NBSP; → " " (single space).
    expect(decodeHtmlEntities("&AMP;&Quot;&NBSP;")).toBe('&" ');
  });

  it("leaves unknown named entities untouched as a debugging breadcrumb", () => {
    // Better to surface `&unknownentity;` so the user notices than to
    // silently drop or mangle it. The text-cleanup goal is "decode
    // what we recognize", not "guarantee no entities survive".
    expect(decodeHtmlEntities("&unknownentity;")).toBe("&unknownentity;");
  });

  it("returns the input unchanged when there are no entities", () => {
    expect(decodeHtmlEntities("plain text with no &amp markers")).toBe(
      "plain text with no &amp markers",
    );
    expect(decodeHtmlEntities("")).toBe("");
  });

  it("ignores out-of-range numeric references rather than throwing", () => {
    expect(decodeHtmlEntities("&#999999999;")).toBe("");
    expect(decodeHtmlEntities("&#-1;")).toBe("&#-1;");
  });
});

describe("formatIsoDuration", () => {
  it("humanizes minutes-only durations (the most common shape)", () => {
    expect(formatIsoDuration("PT45M")).toBe("45 min");
    expect(formatIsoDuration("PT1M")).toBe("1 min");
  });

  it("humanizes hours-and-minutes durations", () => {
    expect(formatIsoDuration("PT1H30M")).toBe("1 hour 30 min");
    expect(formatIsoDuration("PT2H15M")).toBe("2 hours 15 min");
  });

  it("pluralizes hours correctly (1 hour vs 2 hours)", () => {
    expect(formatIsoDuration("PT1H")).toBe("1 hour");
    expect(formatIsoDuration("PT2H")).toBe("2 hours");
  });

  it("handles seconds when there are no minutes or hours", () => {
    expect(formatIsoDuration("PT30S")).toBe("30 sec");
  });

  it("drops sub-minute precision when minutes or hours are present", () => {
    // The original ISO has seconds but for cook-time display, "1 hour
    // 30 sec" is goofy — keep the human-relevant resolution.
    expect(formatIsoDuration("PT1H45S")).toBe("1 hour");
    expect(formatIsoDuration("PT30M45S")).toBe("30 min");
  });

  it("is case-insensitive on the ISO designators", () => {
    expect(formatIsoDuration("pt45m")).toBe("45 min");
  });

  it("passes free-form strings through unchanged (some publishers ignore the spec)", () => {
    // Smitten Kitchen et al. occasionally put "About 1 hour" in
    // totalTime. We don't want to lose that — better unstyled than
    // dropped.
    expect(formatIsoDuration("About 1 hour")).toBe("About 1 hour");
    expect(formatIsoDuration("30 minutes")).toBe("30 minutes");
  });

  it("returns undefined for empty / undefined input", () => {
    expect(formatIsoDuration(undefined)).toBeUndefined();
    expect(formatIsoDuration("")).toBeUndefined();
    expect(formatIsoDuration("   ")).toBeUndefined();
  });

  it("returns the input unchanged when ISO parses to zero", () => {
    // PT0M is technically valid ISO 8601 but useless as a cook time;
    // we hand it back as-is so the caller can decide what to do.
    expect(formatIsoDuration("PT0M")).toBe("PT0M");
  });
});

describe("parseServingsCount", () => {
  it("extracts the integer from canonical schema.org yield strings", () => {
    expect(parseServingsCount("4 servings")).toBe(4);
    expect(parseServingsCount("Serves 4")).toBe(4);
    expect(parseServingsCount("Makes 12 cookies")).toBe(12);
    expect(parseServingsCount("4 servings (large)")).toBe(4);
  });

  it("picks the LOWER bound from a range (under-portion rather than over)", () => {
    expect(parseServingsCount("2-3 servings")).toBe(2);
    expect(parseServingsCount("4 to 6 servings")).toBe(4);
  });

  it("rejects zero and negative values", () => {
    expect(parseServingsCount("0 servings")).toBeUndefined();
  });

  it("rejects implausibly-large values (likely garbage / mis-parse)", () => {
    expect(parseServingsCount("1000 cookies")).toBeUndefined();
  });

  it("returns undefined when there's no integer in the text", () => {
    expect(parseServingsCount("a bowl for one")).toBeUndefined();
    expect(parseServingsCount("plenty for the family")).toBeUndefined();
  });

  it("returns undefined for empty / undefined input", () => {
    expect(parseServingsCount(undefined)).toBeUndefined();
    expect(parseServingsCount("")).toBeUndefined();
  });
});

describe("parseTotalTimeToMinutes", () => {
  it("parses ISO 8601 durations (canonical schema.org shape)", () => {
    expect(parseTotalTimeToMinutes("PT45M")).toBe(45);
    expect(parseTotalTimeToMinutes("PT1H30M")).toBe(90);
    expect(parseTotalTimeToMinutes("PT2H")).toBe(120);
  });

  it("parses humanized free-form shapes (AI output, lazy publishers)", () => {
    expect(parseTotalTimeToMinutes("45 min")).toBe(45);
    expect(parseTotalTimeToMinutes("45 minutes")).toBe(45);
    expect(parseTotalTimeToMinutes("1 hour 30 min")).toBe(90);
    expect(parseTotalTimeToMinutes("2 hours")).toBe(120);
    expect(parseTotalTimeToMinutes("2 hrs")).toBe(120);
  });

  it("extracts a number from a prose-prefixed time (Smitten Kitchen style)", () => {
    expect(parseTotalTimeToMinutes("About 1 hour")).toBe(60);
    expect(parseTotalTimeToMinutes("Around 30 minutes")).toBe(30);
  });

  it("rounds fractional hours to nearest minute", () => {
    expect(parseTotalTimeToMinutes("1.5 hours")).toBe(90);
  });

  it("rounds ISO seconds into minutes (so PT2M30S → 3 min)", () => {
    expect(parseTotalTimeToMinutes("PT2M30S")).toBe(3);
  });

  it("returns undefined for empty / no-time input", () => {
    expect(parseTotalTimeToMinutes(undefined)).toBeUndefined();
    expect(parseTotalTimeToMinutes("")).toBeUndefined();
    expect(parseTotalTimeToMinutes("PT0M")).toBeUndefined();
    expect(parseTotalTimeToMinutes("no time given")).toBeUndefined();
  });
});
