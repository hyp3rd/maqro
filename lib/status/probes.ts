/** Pure aggregation helpers for status probes. Lives outside the
 *  page component so the math is unit-testable without a Supabase
 *  fixture: pass in probe rows, get back the summary the UI
 *  renders.
 *
 *  Why separate from the page: the rollup logic (uptime %, current
 *  status, history bucketing) is fiddly enough that a regression
 *  in it would silently render "100% uptime" while the underlying
 *  data was screaming. Tests pin the math; the page is just
 *  presentation. */

export type CheckStatus = "ok" | "fail" | "skipped";

export type Probe = {
  probed_at: string;
  overall_ok: boolean;
  supabase_status: CheckStatus;
  stripe_status: CheckStatus;
  response_ms: number;
  http_status: number;
};

export type Component = "overall" | "supabase" | "stripe";

/** Minimum probe count before the page is willing to claim a
 *  status ("operational" / "degraded"). 12 probes at the 5-min
 *  cron cadence ≈ 1 hour of history - enough that a transient
 *  Supabase blip doesn't sticker the page red forever, but short
 *  enough that the first real probes after deploy resolve the
 *  "Status unknown" headline within an hour.
 *
 *  Below this count the page renders the existing `'no-data'`
 *  headline with copy that mentions "collecting data". */
export const MIN_CONFIDENT_PROBES = 12;

/** Minimum length of a consecutive-fail run before it surfaces as
 *  an incident. 3 probes ≈ 15 minutes. Anything shorter is treated
 *  as a flicker - a single missed probe or a transient Stripe
 *  blip shouldn't generate an "Ongoing incident" card on the
 *  public status page. */
export const MIN_INCIDENT_RUN_LENGTH = 3;

const STATUS_PALETTE: Record<CheckStatus, string> = {
  ok: "ok",
  fail: "fail",
  skipped: "skipped",
};

/** Pull the component status from one probe. `overall` is computed
 *  from the per-dep checks (`ok` only when every non-skipped dep is
 *  ok); per-component reads directly from the column.
 *
 *  Why `skipped` reads as healthy for uptime: a dependency the
 *  deployment doesn't configure can't be "down" by definition
 *  (e.g. preview envs without Stripe). The marketing claim "we're
 *  up" survives that.
 */
export function componentStatus(p: Probe, c: Component): CheckStatus {
  if (c === "supabase") return p.supabase_status;
  if (c === "stripe") return p.stripe_status;
  // overall: derived. `overall_ok` is the persisted answer; we re-
  // express it as 'ok' | 'fail' to match the component shape so the
  // UI can render it through the same palette.
  return p.overall_ok ? "ok" : "fail";
}

/** Uptime % over a window. 100% when there are zero `fail` probes
 *  AND at least one `ok` (or `skipped`) probe; 0% when there's no
 *  data (the page should treat 0/0 as "no data" rather than "100%
 *  up" - see `summarizeWindow`'s `sampled` field).
 *
 *  Skipped counts as up (see `componentStatus`). */
export function uptimePct(probes: Probe[], c: Component): number {
  if (probes.length === 0) return 0;
  const fails = probes.filter((p) => componentStatus(p, c) === "fail").length;
  return ((probes.length - fails) / probes.length) * 100;
}

export type WindowSummary = {
  /** Number of probes in the window. */
  sampled: number;
  /** Uptime % for this window. Meaningful only when `sampled > 0`. */
  uptimePct: number;
  /** Most recent probe in the window - used for "current status". */
  latest: Probe | null;
};

export function summarizeWindow(
  probes: Probe[],
  windowMs: number,
  c: Component,
  now: number,
): WindowSummary {
  const cutoff = now - windowMs;
  const inWindow = probes.filter((p) => Date.parse(p.probed_at) >= cutoff);
  return {
    sampled: inWindow.length,
    uptimePct: uptimePct(inWindow, c),
    latest: inWindow[0] ?? null,
  };
}

/** Bucket probes into N equally-sized time slots for a heat-strip
 *  visualization. Each bucket reports the worst status in that
 *  slot - a single `fail` taints the bucket, otherwise it's `ok`
 *  (or `skipped` when there's no data). This matches how
 *  status-page heat strips work elsewhere: red dots scream louder
 *  than green ones, and that's the right bias for a status page.
 *
 *  Empty buckets render as `'no-data'` so the UI can grey them
 *  out - distinguishing "we weren't probing yet" from "everything
 *  was fine".
 */
export type BucketStatus = CheckStatus | "no-data";
export type Bucket = { startMs: number; endMs: number; status: BucketStatus };

export function bucketize(
  probes: Probe[],
  c: Component,
  bucketCount: number,
  totalWindowMs: number,
  now: number,
): Bucket[] {
  const bucketMs = totalWindowMs / bucketCount;
  const start = now - totalWindowMs;
  const buckets: Bucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const bStart = start + i * bucketMs;
    const bEnd = bStart + bucketMs;
    const inBucket = probes.filter((p) => {
      const t = Date.parse(p.probed_at);
      return t >= bStart && t < bEnd;
    });
    let status: BucketStatus;
    if (inBucket.length === 0) {
      status = "no-data";
    } else if (inBucket.some((p) => componentStatus(p, c) === "fail")) {
      status = "fail";
    } else if (inBucket.every((p) => componentStatus(p, c) === "skipped")) {
      status = "skipped";
    } else {
      status = "ok";
    }
    buckets.push({ startMs: bStart, endMs: bEnd, status });
  }
  return buckets;
}

/** Walk the probe series newest-first and collapse runs of `fail`
 *  into incident records. An "incident" here is just a contiguous
 *  stretch where the chosen component was down - no human curation,
 *  no severity classification. v1 surfaces the timeline so the
 *  operator can correlate with their own logs; future iterations
 *  can layer on titled / annotated incidents from a separate table.
 *
 *  Probes are assumed sorted newest-first (matches the query
 *  default `.order("probed_at", { ascending: false })`).
 */
export type Incident = {
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  probeCount: number;
};

export function inferIncidents(
  probes: Probe[],
  c: Component,
  minRunLength: number = MIN_INCIDENT_RUN_LENGTH,
): Incident[] {
  const incidents: Incident[] = [];
  // Iterate oldest → newest so end timestamps are the LAST fail in
  // a run (the period closes when the next ok arrives). Count the
  // run length as we go so we can drop sub-threshold flickers.
  const chronological = [...probes].reverse();
  let runStart: Probe | null = null;
  let runLastFail: Probe | null = null;
  let runLength = 0;
  for (const p of chronological) {
    const status = componentStatus(p, c);
    if (status === "fail") {
      if (runStart === null) runStart = p;
      runLastFail = p;
      runLength += 1;
    } else if (runStart && runLastFail) {
      if (runLength >= minRunLength) {
        incidents.push(incidentFromRun(runStart, runLastFail, p, false));
      }
      runStart = null;
      runLastFail = null;
      runLength = 0;
    }
  }
  // Open incident - series ends on a fail without a recovery.
  // Same threshold applies: a single trailing fail isn't an
  // ongoing incident, it's a flicker we'll re-evaluate on the
  // next probe.
  if (runStart && runLastFail && runLength >= minRunLength) {
    incidents.push(incidentFromRun(runStart, runLastFail, null, true));
  }
  // Newest-first for the rendered list.
  return incidents.reverse();
}

function incidentFromRun(
  start: Probe,
  lastFail: Probe,
  recovery: Probe | null,
  openEnded: boolean,
): Incident {
  const startedAtMs = Date.parse(start.probed_at);
  const endedAtMs = recovery
    ? Date.parse(recovery.probed_at)
    : Date.parse(lastFail.probed_at);
  let probeCount = 1;
  // The caller has the original probes; we don't recount here.
  // Estimate by interval if we want - keep it simple for v1.
  probeCount = openEnded
    ? Math.max(1, Math.round((Date.now() - startedAtMs) / (5 * 60 * 1000)))
    : Math.max(1, Math.round((endedAtMs - startedAtMs) / (5 * 60 * 1000)) + 1);
  return {
    startedAt: start.probed_at,
    endedAt: openEnded ? null : (recovery ?? lastFail).probed_at,
    durationMs: endedAtMs - startedAtMs,
    probeCount,
  };
}

export const PALETTE = STATUS_PALETTE;
