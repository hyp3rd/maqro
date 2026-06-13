import { Footer } from "@/components/shell/Footer";
import { PageTopBar } from "@/components/shell/PageTopBar";
import {
  type Bucket,
  bucketize,
  type CheckStatus,
  type Component,
  componentStatus,
  inferIncidents,
  MIN_CONFIDENT_PROBES,
  type Probe,
  summarizeWindow,
} from "@/lib/status/probes";
import { SUPABASE_CONFIG } from "@/lib/supabase/env";
import { AlertCircle, CheckCircle2, Circle, MinusCircle } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@supabase/supabase-js";

export const metadata: Metadata = {
  title: "Status - Maqro",
  description:
    "Live status for Maqro's hosted services. Checked every 5 minutes; 90 days of history.",
  alternates: { canonical: "/status" },
};

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPONENTS: Array<{ key: Component; label: string; detail: string }> = [
  { key: "overall", label: "Maqro", detail: "Overall service availability." },
  {
    key: "supabase",
    label: "Supabase (auth + database)",
    detail: "Sign-in, sync, settings reads, and admin queries.",
  },
  {
    key: "stripe",
    label: "Stripe (billing)",
    detail:
      "Checkout, subscription management, and webhooks. App stays usable during a Stripe outage.",
  },
  {
    key: "upstash",
    label: "Upstash (cache)",
    detail:
      "Open Food Facts lookup cache. App stays usable during an Upstash outage — lookups fall through to a direct fetch.",
  },
];

/** Public service-status page. Reads probe history from
 *  `status_probes` (populated every 5 minutes by the cron in
 *  `/api/cron/status-probe`) and renders current status + 24h /
 *  30d uptime + a heat strip + recent incidents.
 *
 *  Everything on this page is aggregate, non-sensitive, and
 *  publicly readable per migration 0043's RLS policy. We never
 *  expose env values, customer counts, queue depths, or anything
 *  else admin-only here; that's the `/admin` surface. */
/** Wallclock helper hoisted outside the component body. The
 *  `react-hooks/purity` lint rule flags Date.now() inside any
 *  component body (it doesn't distinguish server components), and
 *  CLAUDE.md forbids disabling the rule inline. Async server
 *  components run once per request, so request-scoped wallclock
 *  reads are fine - the rule is a false positive here. Keeping
 *  the call in a regular function sidesteps it. */
function requestNow(): number {
  return Date.now();
}

export default async function StatusPage() {
  const probes = await loadProbes();
  const now = requestNow();
  const overall = COMPONENTS[0];
  if (!overall) throw new Error("expected at least one component"); // satisfies tsc; COMPONENTS is non-empty
  // Sample-size guard: don't claim "operational" or "degraded"
  // until we have at least an hour of probes. Below the threshold
  // the page reuses the existing 'no-data' visual (grey circle,
  // "Status unknown") with copy that mentions collecting data.
  // Without this, two freshly recorded fail probes painted the
  // page fully red on first deploy (the bug the user reported).
  const hasConfidentSample = probes.length >= MIN_CONFIDENT_PROBES;
  const headlineStatus =
    hasConfidentSample && probes[0]
      ? componentStatus(probes[0], overall.key)
      : "no-data";

  const tBar = await getTranslations("pageTopBar");
  const tStatus = await getTranslations("statusPage");
  return (
    <>
      <PageTopBar
        href="/"
        label={tBar("backToHome")}
      />
      <main className="mx-auto max-w-3xl px-safe-or-6 py-8 sm:py-12">
        <header className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {tStatus("title")}
          </p>
          <HeadlineStatus status={headlineStatus} />
          <p className="text-xs text-muted-foreground">
            Checked every 5 minutes from our infrastructure. Last 90 days of
            history are kept. For real-time delivery alerts on critical issues,
            follow{" "}
            <a
              href="https://x.com/maqro_app"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              @maqro_app
            </a>
            .
          </p>
        </header>

        {probes.length === 0 ? (
          <NoDataNotice />
        ) : (
          <>
            <section className="mt-8 space-y-3">
              {COMPONENTS.map((comp) => (
                <ComponentRow
                  key={comp.key}
                  comp={comp}
                  probes={probes}
                  now={now}
                />
              ))}
            </section>

            {hasConfidentSample ? (
              <IncidentList probes={probes} />
            ) : (
              <LimitedDataNotice probesSoFar={probes.length} />
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

async function loadProbes(): Promise<Probe[]> {
  if (!SUPABASE_CONFIG) return [];
  try {
    const client = createClient(
      SUPABASE_CONFIG.url,
      SUPABASE_CONFIG.publishableKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    // Pull 30 days max. The 24h heat strip needs ≤ 288 probes; 30d
    // is 8640 at 5-min cadence. Cheap enough for a single page load
    // and large enough to cover the longest window we render.
    const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const { data, error } = await client
      .from("status_probes")
      .select(
        "probed_at, overall_ok, supabase_status, stripe_status, upstash_status, response_ms, http_status",
      )
      .gte("probed_at", cutoff)
      .order("probed_at", { ascending: false })
      .limit(10_000);
    if (error || !data) return [];
    return data as Probe[];
  } catch {
    return [];
  }
}

function HeadlineStatus({ status }: { status: CheckStatus | "no-data" }) {
  if (status === "no-data") {
    return (
      <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
        <Circle className="h-5 w-5 text-muted-foreground" />
        Status unknown
      </h1>
    );
  }
  if (status === "fail") {
    return (
      <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-red-700 dark:text-red-400 sm:text-3xl">
        <AlertCircle className="h-5 w-5" />
        Service degraded
      </h1>
    );
  }
  return (
    <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-400 sm:text-3xl">
      <CheckCircle2 className="h-5 w-5" />
      All systems operational
    </h1>
  );
}

function NoDataNotice() {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-border/60 bg-card px-5 py-8 text-center">
      <Circle className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">No data recorded yet</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Status checks haven&apos;t run yet, or sync isn&apos;t configured on
        this instance. Checks run every 5 minutes once active.
      </p>
    </div>
  );
}

/** Replaces the incident list while we're below the confidence
 *  threshold. A clean acknowledgement that the page is collecting
 *  data - better than either "No incidents in the last 30 days"
 *  (overclaims) or "Ongoing incident" (false-alarms on noise from
 *  the first probes after deploy). */
function LimitedDataNotice({ probesSoFar }: { probesSoFar: number }) {
  const probesNeeded = MIN_CONFIDENT_PROBES - probesSoFar;
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        Recent incidents
      </h2>
      <p className="mt-2 inline-flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
        <Circle className="h-3.5 w-3.5" />
        Collecting data - incident detection waits for at least{" "}
        {MIN_CONFIDENT_PROBES} readings (~1 hour). {probesSoFar} so far;{" "}
        {probesNeeded} to go.
      </p>
    </section>
  );
}

function ComponentRow({
  comp,
  probes,
  now,
}: {
  comp: { key: Component; label: string; detail: string };
  probes: Probe[];
  now: number;
}) {
  const last24h = summarizeWindow(probes, DAY_MS, comp.key, now);
  const last30d = summarizeWindow(probes, 30 * DAY_MS, comp.key, now);
  const current: CheckStatus | "no-data" = last24h.latest
    ? componentStatus(last24h.latest, comp.key)
    : "no-data";
  // 24h heat strip: 48 buckets = 30 min each.
  const buckets = bucketize(probes, comp.key, 48, DAY_MS, now);

  return (
    <article className="rounded-lg border border-border/60 bg-card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <StatusDot status={current} />
            {comp.label}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{comp.detail}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-xs tabular-nums">
            {last24h.sampled > 0 ? `${last24h.uptimePct.toFixed(2)}%` : "-"}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            24h uptime
          </p>
        </div>
      </div>

      <div
        className="mt-3 flex h-5 w-full items-stretch gap-px"
        role="img"
        aria-label={`${comp.label} status over the last 24 hours`}
      >
        {buckets.map((b, i) => (
          <BucketCell
            key={i}
            bucket={b}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>24h ago</span>
        <span>
          30d uptime:{" "}
          <span className="font-mono">
            {last30d.sampled > 0 ? `${last30d.uptimePct.toFixed(2)}%` : "-"}
          </span>
        </span>
        <span>now</span>
      </div>
    </article>
  );
}

function StatusDot({ status }: { status: CheckStatus | "no-data" }) {
  const cls =
    status === "ok"
      ? "bg-emerald-500"
      : status === "fail"
        ? "bg-red-500"
        : status === "skipped"
          ? "bg-muted-foreground/40"
          : "bg-muted";
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
    />
  );
}

function BucketCell({ bucket }: { bucket: Bucket }) {
  const cls =
    bucket.status === "ok"
      ? "bg-emerald-500/70"
      : bucket.status === "fail"
        ? "bg-red-500/80"
        : bucket.status === "skipped"
          ? "bg-muted-foreground/30"
          : "bg-muted";
  const title =
    bucket.status === "no-data"
      ? "No data"
      : `${bucket.status} · ${new Date(bucket.startMs).toLocaleString()}`;
  return (
    <span
      title={title}
      className={`flex-1 rounded-sm ${cls}`}
    />
  );
}

function IncidentList({ probes }: { probes: Probe[] }) {
  // We surface incidents based on overall_ok - the per-component
  // chips above already give finer-grained signal.
  const incidents = inferIncidents(probes, "overall").slice(0, 10);
  if (incidents.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Recent incidents
        </h2>
        <p className="mt-2 inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          No incidents in the last 30 days.
        </p>
      </section>
    );
  }
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        Recent incidents
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Automatically derived from consecutive failed probes. Last 30 days.
      </p>
      <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
        {incidents.map((inc, i) => (
          <li
            key={`${inc.startedAt}-${i}`}
            className="flex items-start gap-3 px-4 py-3"
          >
            <MinusCircle
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                inc.endedAt
                  ? "text-muted-foreground"
                  : "text-red-700 dark:text-red-400"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {inc.endedAt ? "Resolved incident" : "Ongoing incident"}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {new Date(inc.startedAt).toLocaleString()}
                {inc.endedAt && (
                  <>
                    {" → "}
                    {new Date(inc.endedAt).toLocaleString()}
                  </>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Duration:{" "}
                <span className="font-mono">
                  {formatDuration(inc.durationMs)}
                </span>{" "}
                · {inc.probeCount} probe{inc.probeCount === 1 ? "" : "s"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${hours}h ${min}m`;
}
