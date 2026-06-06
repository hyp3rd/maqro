"use client";

import { LogoWordmark } from "@/components/shell/LogoWordmark";
import { Button } from "@/components/ui/button";
import {
  listDailyLogs,
  listPantryItems,
  listShoppingListMeta,
  todayKey,
  type DailyLog,
  type PantryItem,
  type ShoppingListMeta,
} from "@/lib/db";
import {
  buildDisplayItems,
  computeShoppingList,
  type DisplayItem,
} from "@/lib/shopping-list";
import {
  categorizeFallback,
  SHOPPING_AISLES,
  type ShoppingAisle,
} from "@/lib/shopping/categorize";
import { APP_VERSION } from "@/lib/version";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Dedicated print-optimised shopping-list report.
 *
 *  Mirrors the structure of [/report](../report/page.tsx) — the
 *  Progress export — so the two reports share a visual house style.
 *  Reached via the Export PDF button on the in-app shopping list,
 *  which passes `?preset=…&start=YYYY-MM-DD&end=YYYY-MM-DD`. The
 *  page reads the same IDB stores the live ShoppingListView reads
 *  (dailyLogs + shoppingListMeta + pantryItems) and renders a
 *  single-column, print-first layout with grouped aisles, item
 *  totals, and any user-attached notes.
 *
 *  A sticky toolbar at the top gives the user a clean Save-as-PDF
 *  affordance + a Back-to-the-app escape; both hide on print so they
 *  don't appear in the final PDF.
 *
 *  Why a dedicated route over an in-page modal: print preview shows
 *  exactly what the route renders. App chrome (sidebar, topbar,
 *  toasts) never appears in the document, page-break-inside rules
 *  apply cleanly, and the URL is shareable + re-printable without
 *  touching app state. */
export default function ShoppingReportPage() {
  return (
    <Suspense fallback={<ReportLoading />}>
      <ReportClient />
    </Suspense>
  );
}

function ReportLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Building shopping list…
    </div>
  );
}

function ReportClient() {
  const params = useSearchParams();
  const preset = params.get("preset") ?? "next-7";
  const start = params.get("start") ?? todayKey();
  const end = params.get("end") ?? todayKey();

  const [state, setState] = useState<
    | { kind: "loading" }
    | {
        kind: "ok";
        logs: DailyLog[];
        meta: Map<string, ShoppingListMeta>;
        pantry: Map<string, PantryItem>;
        generatedAt: Date;
      }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  /** Incremented when the user re-focuses the report tab. The fetch
   *  effect depends on this so returning to the tab after editing in
   *  the live tab pulls a fresh snapshot of IDB — bounds the
   *  staleness window the user can hit without re-opening the
   *  report. */
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    function onFocus() {
      setRefreshTick((n) => n + 1);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listDailyLogs(), listShoppingListMeta(), listPantryItems()])
      .then(([logs, metaRows, pantryRows]) => {
        if (cancelled) return;
        setState({
          kind: "ok",
          logs: logs ?? [],
          meta: new Map(metaRows.map((m) => [m.name, m])),
          pantry: new Map(
            (pantryRows ?? []).map((p) => [p.name.toLowerCase().trim(), p]),
          ),
          generatedAt: new Date(),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't load data",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  if (state.kind === "loading") return <ReportLoading />;
  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <ReportBody
      preset={preset}
      start={start}
      end={end}
      logs={state.logs}
      meta={state.meta}
      pantry={state.pantry}
      generatedAt={state.generatedAt}
    />
  );
}

/** Display row for the report — same shape as ShoppingListView's
 *  DisplayItem but kept local since this file doesn't import from
 *  the live view. Extras carry their own unit; computed rows use
 *  the implicit "g" of `totalGrams`. */
type ReportItem = DisplayItem;

const PRESET_LABEL: Record<string, string> = {
  today: "Today",
  "this-week": "This week",
  "next-7": "Next 7 days",
  "last-7": "Last 7 days",
};

function ReportBody({
  preset,
  start,
  end,
  logs,
  meta,
  pantry,
  generatedAt,
}: {
  preset: string;
  start: string;
  end: string;
  logs: DailyLog[];
  meta: Map<string, ShoppingListMeta>;
  pantry: Map<string, PantryItem>;
  generatedAt: Date;
}) {
  /** Same three-pass derivation as ShoppingListView: compute from
   *  logs, apply per-item qtyOverride, then merge in any manual
   *  extras the user has flagged. Kept inline so the report page
   *  doesn't depend on the live view's hooks — purely declarative. */
  const items = useMemo<ReportItem[]>(
    () =>
      buildDisplayItems(computeShoppingList(logs, start, end), meta, pantry),
    [logs, start, end, meta, pantry],
  );

  /** Same three-tier resolver as ShoppingListView: meta override →
   *  pantry-item aisle → deterministic fallback. */
  const grouped = useMemo(() => {
    const buckets = new Map<ShoppingAisle, ReportItem[]>();
    for (const item of items) {
      const key = item.name.toLowerCase().trim();
      const aisle =
        meta.get(key)?.category ??
        pantry.get(key)?.category ??
        categorizeFallback(item.name);
      const existing = buckets.get(aisle);
      if (existing) existing.push(item);
      else buckets.set(aisle, [item]);
    }
    return SHOPPING_AISLES.flatMap((aisle) => {
      const rows = buckets.get(aisle);
      return rows ? [{ aisle, rows }] : [];
    });
  }, [items, meta, pantry]);

  const totalItems = items.length;
  const totalGrams = items.reduce((sum, it) => sum + it.totalGrams, 0);
  const rangeLabel = `${dayLabel(start)} → ${dayLabel(end)}`;
  const presetLabel = PRESET_LABEL[preset] ?? preset;

  return (
    <main className="mx-auto max-w-3xl px-safe-or-6 py-8 print:max-w-none print:px-0 print:py-0">
      <div className="print-hide sticky top-0 z-10 mb-6 flex items-center justify-between gap-2 border-b border-border/60 bg-background/85 px-1 pb-2 pt-safe-plus-2 backdrop-blur">
        <Link
          href="/app"
          aria-label="Back to app"
          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back to app</span>
        </Link>
        <Button
          type="button"
          size="sm"
          onClick={() => window.print()}
          className="gap-1.5"
        >
          <Printer className="h-3.5 w-3.5" />
          Save as PDF
        </Button>
      </div>

      <header className="space-y-2">
        {/* Branded header — the logo lockup left, build meta right, matching
            the health report's PDF so a printed shopping list looks of-a-piece. */}
        <div className="flex items-center justify-between gap-2">
          <LogoWordmark
            size={20}
            className="text-primary"
          />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground print:text-black">
            maqro.app · v{APP_VERSION}
          </span>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Shopping list
        </h1>
        <p className="text-xs text-muted-foreground">
          {presetLabel} · {rangeLabel} ·{" "}
          {totalItems > 0
            ? `${totalItems} item${totalItems === 1 ? "" : "s"}`
            : "no items"}
        </p>
        {/* Snapshot timestamp — the report tab caches IDB on open
            and refreshes when the tab regains focus. Surfacing the
            generated-at time lets the user tell at a glance whether
            the printed PDF matches the live list. */}
        <p className="text-[10px] text-muted-foreground/70">
          Snapshot generated{" "}
          {generatedAt.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <hr className="my-4 border-t border-border/60" />
      </header>

      {totalItems === 0 ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          Nothing planned in this range. Add a meal to today or any day in the
          range, then re-export.
        </p>
      ) : (
        <>
          <div className="space-y-5 print:space-y-3">
            {grouped.map(({ aisle, rows }) => (
              <section
                key={aisle}
                className="break-inside-avoid"
              >
                <h2 className="mb-2 border-b border-border/60 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground print:border-foreground/40 print:text-black">
                  {aisle}{" "}
                  <span className="text-muted-foreground/70">
                    · {rows.length}
                  </span>
                </h2>
                <ul className="space-y-1.5 text-sm">
                  {rows.map((it) => {
                    const note = meta.get(it.name.toLowerCase().trim())?.notes;
                    return (
                      <li
                        key={it.name}
                        className="break-inside-avoid"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="flex min-w-0 items-baseline gap-3">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 shrink-0 accent-foreground"
                              aria-hidden
                              readOnly
                            />
                            <span className="font-medium">{it.name}</span>
                            {it.isExtra && (
                              <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-amber-700 print:border print:border-amber-400 print:bg-transparent dark:text-amber-400">
                                Restock
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                            {it.isExtra
                              ? `${it.totalGrams} ${it.extraUnit ?? "g"} · restock`
                              : `${it.totalGrams} g · ${it.appearances}×`}
                          </span>
                        </div>
                        {note && (
                          <p className="ml-7 text-[11px] italic text-muted-foreground print:text-black">
                            {note}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <aside className="mt-8 break-inside-avoid rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-xs print:border-foreground/40 print:bg-transparent">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Totals
            </p>
            <p className="mt-1 font-mono tabular-nums">
              {totalItems} item{totalItems === 1 ? "" : "s"} · {totalGrams} g
            </p>
          </aside>
        </>
      )}

      <footer className="mt-8 border-t border-border/60 pt-3 text-[10px] text-muted-foreground print:border-foreground/40">
        <p>
          Aggregated from the meal slots logged on this device. Aisle overrides
          and notes are local to this device until cross-device sync is wired.
        </p>
      </footer>
    </main>
  );
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
