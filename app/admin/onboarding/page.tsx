import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { Activity, ChartNoAxesColumn } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** Admin funnel view for the onboarding wizard.
 *
 *  Reads aggregate counters from `onboarding_step_counters`
 *  (migration 0042) and renders the daily drop-off shape:
 *
 *    Step 0 (welcome) ── 1,234 entered
 *    Step 1 (basics)  ── 1,100 entered  (-10.9% vs prev)
 *    Step 2 (activity)── 950   entered  (-13.6% vs prev)
 *    Step 3 (diet)    ── 880   entered  (-7.4% vs prev)
 *
 *    Finished:  720   (58.3% of starts)
 *    Skipped:   514   (41.6% of starts)
 *
 *  Aggregate-only - see migration 0042 for the privacy rationale.
 *  There is nothing per-user on this page because there is nothing
 *  per-user in the table. */

const STEP_LABELS: Record<number, string> = {
  0: "Welcome",
  1: "Basics",
  2: "Activity & goal",
  3: "Diet preference",
};

const RANGES = {
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
} as const;

type RangeKey = keyof typeof RANGES;

type Row = {
  day: string;
  step: number;
  action: "enter" | "skip" | "finish";
  count: number;
};

/** ISO date string for `days` days ago. Lives outside the component
 *  so the `Date.now()` call doesn't sit inside an async server
 *  component body (where `react-hooks/purity` flags it as impure
 *  even though server components run once per request, not on
 *  re-render). The data this returns is request-scoped - the page
 *  is `force-dynamic` so the cutoff is always fresh. */
function isoCutoff(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default async function AdminOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/app");

  const sp = await searchParams;
  const range: RangeKey =
    sp.range && sp.range in RANGES ? (sp.range as RangeKey) : "30d";
  const days = RANGES[range].days;

  const config = getSupabaseSecretConfig();
  if (!config) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={ChartNoAxesColumn}
          title="Onboarding funnel"
          description="Aggregate drop-off across the first-run wizard."
        />
        <EmptyState
          icon={Activity}
          title="Supabase isn't configured"
          description="Service-role key missing; the funnel counters can't be read."
        />
      </div>
    );
  }

  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sinceDay = isoCutoff(days);

  const { data, error } = await admin
    .from("onboarding_step_counters")
    .select("day, step, action, count")
    .gte("day", sinceDay)
    .order("day", { ascending: false });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={ChartNoAxesColumn}
          title="Onboarding funnel"
          description="Aggregate drop-off across the first-run wizard."
        />
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-600">
          {error.message}
        </div>
      </div>
    );
  }

  const rows = (data ?? []) as Row[];
  const totals = summarize(rows);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ChartNoAxesColumn}
        title="Onboarding funnel"
        description="Daily aggregate counts. No per-user data is stored - see migration 0042 for the privacy rationale."
        tone="blue"
        actions={<RangeSwitcher current={range} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No events yet"
          description={`No onboarding traffic in the ${RANGES[range].label.toLowerCase()}. Either the wizard hasn't been shown to anyone, or the SUPABASE migration 0042 hasn't been applied.`}
        />
      ) : (
        <>
          <FunnelCard totals={totals} />
          <DailyTable rows={rows} />
        </>
      )}
    </div>
  );
}

function RangeSwitcher({ current }: { current: RangeKey }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5 text-[11px]">
      {(Object.keys(RANGES) as RangeKey[]).map((k) => (
        <a
          key={k}
          href={`?range=${k}`}
          className={`rounded px-2 py-1 transition-colors ${
            current === k
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          {RANGES[k].label}
        </a>
      ))}
    </div>
  );
}

/** Roll the per-day rows up into one number per (step, action). */
function summarize(rows: Row[]): {
  perStep: Map<number, { enter: number; skip: number; finish: number }>;
  totalSteps: number;
} {
  const perStep = new Map<
    number,
    { enter: number; skip: number; finish: number }
  >();
  let maxStep = 0;
  for (const row of rows) {
    if (row.step > maxStep) maxStep = row.step;
    const bucket = perStep.get(row.step) ?? { enter: 0, skip: 0, finish: 0 };
    bucket[row.action] += row.count;
    perStep.set(row.step, bucket);
  }
  return { perStep, totalSteps: maxStep + 1 };
}

function FunnelCard({ totals }: { totals: ReturnType<typeof summarize> }) {
  const { perStep, totalSteps } = totals;
  const step0 = perStep.get(0)?.enter ?? 0;
  const finishTotal = Array.from(perStep.values()).reduce(
    (acc, b) => acc + b.finish,
    0,
  );
  const skipTotal = Array.from(perStep.values()).reduce(
    (acc, b) => acc + b.skip,
    0,
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Funnel</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Drop-off between successive step entries. Bars are scaled against step
          0 = 100%.
        </p>
      </header>
      <ul className="divide-y divide-border/60">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const enters = perStep.get(i)?.enter ?? 0;
          const prev = i === 0 ? null : (perStep.get(i - 1)?.enter ?? 0);
          const dropPct =
            prev && prev > 0 ? ((prev - enters) / prev) * 100 : null;
          const widthPct = step0 > 0 ? (enters / step0) * 100 : 0;
          return (
            <li
              key={i}
              className="px-5 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">
                  Step {i}{" "}
                  <span className="font-normal text-muted-foreground">
                    {STEP_LABELS[i] ?? "-"}
                  </span>
                </p>
                <p className="font-mono text-xs tabular-nums">
                  {enters.toLocaleString()}
                  {dropPct !== null && (
                    <span
                      className={`ml-2 text-[11px] ${
                        dropPct > 25
                          ? "text-red-700 dark:text-red-400"
                          : dropPct > 10
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      −{dropPct.toFixed(1)}%
                    </span>
                  )}
                </p>
              </div>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-foreground/80"
                  style={{ width: `${widthPct.toFixed(1)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <footer className="grid grid-cols-2 gap-4 border-t border-border/60 px-5 py-3 text-xs">
        <Stat
          label="Finished"
          value={finishTotal}
          ofStarts={step0}
          tone="emerald"
        />
        <Stat
          label="Skipped"
          value={skipTotal}
          ofStarts={step0}
          tone="amber"
        />
      </footer>
    </section>
  );
}

function Stat({
  label,
  value,
  ofStarts,
  tone,
}: {
  label: string;
  value: number;
  ofStarts: number;
  tone: "emerald" | "amber";
}) {
  const pct = ofStarts > 0 ? (value / ofStarts) * 100 : null;
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-base tabular-nums ${
          tone === "emerald"
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-amber-700 dark:text-amber-400"
        }`}
      >
        {value.toLocaleString()}
        {pct !== null && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {pct.toFixed(1)}% of starts
          </span>
        )}
      </p>
    </div>
  );
}

function DailyTable({ rows }: { rows: Row[] }) {
  // Group rows by day for the per-day breakdown.
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = byDay.get(row.day) ?? [];
    bucket.push(row);
    byDay.set(row.day, bucket);
  }
  const days = Array.from(byDay.keys()).sort().reverse();

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <header className="border-b border-border/60 px-5 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Per-day</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Raw counts. `enter` is the funnel signal; `finish` is the terminal
          success; `skip` is the terminal abandonment.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Day</th>
              <th className="px-4 py-2 text-right font-medium">Start</th>
              <th className="px-4 py-2 text-right font-medium">Step 1</th>
              <th className="px-4 py-2 text-right font-medium">Step 2</th>
              <th className="px-4 py-2 text-right font-medium">Step 3</th>
              <th className="px-4 py-2 text-right font-medium">Finished</th>
              <th className="px-4 py-2 text-right font-medium">Skipped</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {days.map((day) => {
              const dayRows = byDay.get(day) ?? [];
              const at = (step: number, action: Row["action"]) =>
                dayRows
                  .filter((r) => r.step === step && r.action === action)
                  .reduce((acc, r) => acc + r.count, 0);
              const finish = dayRows
                .filter((r) => r.action === "finish")
                .reduce((acc, r) => acc + r.count, 0);
              const skip = dayRows
                .filter((r) => r.action === "skip")
                .reduce((acc, r) => acc + r.count, 0);
              return (
                <tr key={day}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-muted-foreground">
                    {day}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                    {at(0, "enter")}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                    {at(1, "enter")}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                    {at(2, "enter")}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                    {at(3, "enter")}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
                    {finish}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-amber-700 dark:text-amber-400">
                    {skip}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
