"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiUsage } from "@/hooks/use-ai-usage";

/** Surfaces the caller's monthly AI-call usage against the free-tier
 *  cap. Hidden for guests (no usage to show), collapsed to a one-line
 *  unmetered note for premium users, and rendered as a progress bar
 *  + counter for free users. A "near cap" warning fires at 80% used
 *  so the user has a chance to upgrade before they're locked out
 *  mid-task. Lives in the Profile "Billing & subscription" subsection
 *  beside the plan/upgrade card (both read the same `useAiUsage`). */
export function AiUsageSection() {
  const { state: usage, refresh } = useAiUsage();

  if (usage.status === "anon" || usage.status === "error") return null;

  const header = (
    <header className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">AI usage</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          AI features (Auto-fill meal plans, Generate recipes, Identify meal
          photos) share one monthly quota.
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={refresh}
        className="h-8 shrink-0 text-xs text-muted-foreground"
        title="Re-fetch the current counter from the server"
      >
        Refresh
      </Button>
    </header>
  );

  // Reserve the meter's height while the counter loads, so the card holds
  // its place instead of popping in from nothing when it resolves.
  if (usage.status === "loading") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <div className="space-y-3 px-5 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-1 w-full rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-11/12" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
        </div>
      </section>
    );
  }

  const data = usage.data;
  const cap = data.cap;
  const pct = cap ? Math.min(100, Math.round((data.used / cap) * 100)) : 0;
  const nearCap = cap !== null && data.used >= Math.floor(cap * 0.8);
  const atCap = cap !== null && data.used >= cap;

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {header}

      <div className="px-5 py-4">
        {data.isPremium || cap === null ? (
          <p className="text-sm text-foreground">
            <span className="font-medium">Premium</span> - AI features are
            unmetered on your account.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm">
                <span className="font-mono font-medium tabular-nums">
                  {data.used} / {cap}
                </span>{" "}
                <span className="text-muted-foreground">
                  AI calls this month
                </span>
              </p>
              <p
                className={`text-xs tabular-nums ${
                  atCap
                    ? "text-rose-600 dark:text-rose-400"
                    : nearCap
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-muted-foreground"
                }`}
              >
                {atCap
                  ? "Cap reached"
                  : nearCap
                    ? `${cap - data.used} left`
                    : `${pct}%`}
              </p>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                  atCap
                    ? "bg-rose-500"
                    : nearCap
                      ? "bg-amber-500"
                      : "bg-foreground"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Resets the 1st of each month. When you hit the cap, the app falls
              back to the deterministic planner for meal generation and disables
              AI photo identification + recipe generation until the next cycle.
              Manual entry, barcode-scan, and OFF search keep working.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default AiUsageSection;
