import { describe, expect, it } from "vitest";
import {
  bucketize,
  componentStatus,
  inferIncidents,
  MIN_CONFIDENT_PROBES,
  MIN_INCIDENT_RUN_LENGTH,
  type Probe,
  summarizeWindow,
  uptimePct,
} from "./probes";

/** Build a probe with `iso` as `probed_at` and per-dep statuses;
 *  `overall_ok` is derived to keep the fixture concise. */
function probe(
  iso: string,
  supabase: Probe["supabase_status"],
  stripe: Probe["stripe_status"] = "ok",
  upstash: Probe["upstash_status"] = "ok",
): Probe {
  const allCriticalOk = supabase === "ok" || supabase === "skipped";
  return {
    probed_at: iso,
    overall_ok: allCriticalOk,
    supabase_status: supabase,
    stripe_status: stripe,
    upstash_status: upstash,
    response_ms: 50,
    http_status: allCriticalOk ? 200 : 503,
  };
}

describe("componentStatus", () => {
  it("reads per-component status straight from the row", () => {
    const p = probe("2026-05-24T12:00:00Z", "fail", "ok", "skipped");
    expect(componentStatus(p, "supabase")).toBe("fail");
    expect(componentStatus(p, "stripe")).toBe("ok");
    expect(componentStatus(p, "upstash")).toBe("skipped");
  });

  it("derives 'overall' from the persisted overall_ok flag", () => {
    const p = probe("2026-05-24T12:00:00Z", "ok");
    expect(componentStatus(p, "overall")).toBe("ok");
    const p2 = probe("2026-05-24T12:00:00Z", "fail");
    expect(componentStatus(p2, "overall")).toBe("fail");
  });
});

describe("uptimePct", () => {
  it("returns 0 for an empty series (no data ≠ 100% up)", () => {
    expect(uptimePct([], "overall")).toBe(0);
  });

  it("treats skipped as healthy (no claim made = no outage)", () => {
    const series: Probe[] = [
      probe("2026-05-24T11:55:00Z", "skipped"),
      probe("2026-05-24T12:00:00Z", "skipped"),
    ];
    expect(uptimePct(series, "supabase")).toBe(100);
  });

  it("computes uptime % as (1 - fails/total) * 100", () => {
    const series: Probe[] = [
      probe("2026-05-24T12:00:00Z", "ok"),
      probe("2026-05-24T11:55:00Z", "ok"),
      probe("2026-05-24T11:50:00Z", "fail"),
      probe("2026-05-24T11:45:00Z", "ok"),
    ];
    expect(uptimePct(series, "supabase")).toBeCloseTo(75, 5);
  });
});

describe("summarizeWindow", () => {
  const now = Date.parse("2026-05-24T12:00:00Z");
  const series: Probe[] = [
    probe("2026-05-24T11:55:00Z", "ok"), // 5 min ago
    probe("2026-05-24T11:50:00Z", "ok"), // 10 min ago
    probe("2026-05-23T11:55:00Z", "fail"), // ~24h ago + a bit
    probe("2026-05-22T12:00:00Z", "fail"), // 48h ago
  ];

  it("only considers probes within the window", () => {
    const oneHour = summarizeWindow(series, 60 * 60 * 1000, "overall", now);
    expect(oneHour.sampled).toBe(2);
    expect(oneHour.uptimePct).toBe(100);
  });

  it("returns the latest probe in the window for current status", () => {
    const oneDay = summarizeWindow(series, 24 * 60 * 60 * 1000, "overall", now);
    // The most recent of the 5-min/10-min probes — both inside the
    // 24h cutoff (the cutoff sits at probe[2]'s timestamp boundary,
    // exclusive on the older side).
    expect(oneDay.latest?.probed_at).toBe("2026-05-24T11:55:00Z");
  });

  it("returns sampled=0 with no latest when the window has no data", () => {
    const summary = summarizeWindow(series, 1000, "overall", now);
    expect(summary.sampled).toBe(0);
    expect(summary.latest).toBe(null);
    expect(summary.uptimePct).toBe(0);
  });
});

describe("bucketize", () => {
  const now = Date.parse("2026-05-24T12:00:00Z");
  const dayMs = 24 * 60 * 60 * 1000;

  it("returns the requested number of buckets", () => {
    const buckets = bucketize([], "overall", 24, dayMs, now);
    expect(buckets).toHaveLength(24);
  });

  it("marks empty buckets as 'no-data' so the UI can grey them out", () => {
    const buckets = bucketize([], "overall", 4, dayMs, now);
    expect(buckets.every((b) => b.status === "no-data")).toBe(true);
  });

  it("a single fail in a bucket taints the whole bucket (worst wins)", () => {
    // One bucket per 6 hours; place an ok + a fail in the same 6h window.
    const series: Probe[] = [
      probe("2026-05-24T11:55:00Z", "ok"),
      probe("2026-05-24T11:00:00Z", "fail"),
    ];
    const buckets = bucketize(series, "overall", 4, dayMs, now);
    // Last bucket covers 06:00 → 12:00 — both probes fall in it.
    expect(buckets[3]?.status).toBe("fail");
  });

  it("all-skipped buckets render as 'skipped' (not 'ok')", () => {
    const series: Probe[] = [
      probe("2026-05-24T11:55:00Z", "skipped", "skipped"),
    ];
    const buckets = bucketize(series, "supabase", 4, dayMs, now);
    expect(buckets[3]?.status).toBe("skipped");
  });
});

describe("inferIncidents", () => {
  it("returns no incidents for an all-ok series", () => {
    const series: Probe[] = [
      probe("2026-05-24T12:00:00Z", "ok"),
      probe("2026-05-24T11:55:00Z", "ok"),
    ];
    expect(inferIncidents(series, "overall")).toEqual([]);
  });

  it("collapses a run of consecutive fails into one incident", () => {
    // Newest-first, as the route returns. Series shape:
    //   ok @ 12:00  ← recovery
    //   fail @ 11:55
    //   fail @ 11:50
    //   fail @ 11:45 ← start
    //   ok @ 11:40
    const series: Probe[] = [
      probe("2026-05-24T12:00:00Z", "ok"),
      probe("2026-05-24T11:55:00Z", "fail"),
      probe("2026-05-24T11:50:00Z", "fail"),
      probe("2026-05-24T11:45:00Z", "fail"),
      probe("2026-05-24T11:40:00Z", "ok"),
    ];
    const incidents = inferIncidents(series, "overall");
    expect(incidents).toHaveLength(1);
    const inc = incidents[0];
    expect(inc).toBeDefined();
    if (!inc) return;
    expect(inc.startedAt).toBe("2026-05-24T11:45:00Z");
    expect(inc.endedAt).toBe("2026-05-24T12:00:00Z");
    expect(inc.durationMs).toBe(15 * 60 * 1000);
  });

  it("marks an open incident when the series ends on a long-enough fail run", () => {
    // ≥ 3 trailing fails clears the default minRunLength threshold;
    // the series ending without a recovery means endedAt is null.
    const series: Probe[] = [
      probe("2026-05-24T12:00:00Z", "fail"),
      probe("2026-05-24T11:55:00Z", "fail"),
      probe("2026-05-24T11:50:00Z", "fail"),
    ];
    const incidents = inferIncidents(series, "overall");
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.endedAt).toBe(null);
  });
});

describe("inferIncidents — minRunLength threshold", () => {
  it("exports a default minRunLength = 3 (≈15 minutes of consecutive fails)", () => {
    expect(MIN_INCIDENT_RUN_LENGTH).toBe(3);
  });

  it("filters out fail runs shorter than minRunLength", () => {
    // 2 fails — below the default of 3. Should produce no
    // incident, even though the series ends on a fail.
    const series: Probe[] = [
      probe("2026-05-24T12:00:00Z", "fail"),
      probe("2026-05-24T11:55:00Z", "fail"),
    ];
    expect(inferIncidents(series, "overall")).toEqual([]);
  });

  it("filters out a sub-threshold run between two ok stretches", () => {
    // A single flicker bracketed by ok probes — should not surface.
    const series: Probe[] = [
      probe("2026-05-24T12:00:00Z", "ok"),
      probe("2026-05-24T11:55:00Z", "fail"),
      probe("2026-05-24T11:50:00Z", "fail"),
      probe("2026-05-24T11:45:00Z", "ok"),
    ];
    expect(inferIncidents(series, "overall")).toEqual([]);
  });

  it("respects a custom minRunLength when callers pass one", () => {
    // Same 2-fail series, minRunLength=1 — the old behaviour
    // ("any fail run is an incident") restored on demand.
    const series: Probe[] = [
      probe("2026-05-24T12:00:00Z", "fail"),
      probe("2026-05-24T11:55:00Z", "fail"),
    ];
    expect(inferIncidents(series, "overall", 1)).toHaveLength(1);
  });
});

describe("MIN_CONFIDENT_PROBES", () => {
  it("is 12 (1 hour of 5-min probes)", () => {
    // Pinned so a downstream consumer of the constant doesn't
    // silently drift if someone re-tunes it.
    expect(MIN_CONFIDENT_PROBES).toBe(12);
  });
});
