"use client";

import { StreakChip } from "@/components/macro/StreakChip";
import { NumberTicker } from "@/components/shell/NumberTicker";
import React, { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  CalculatedValues,
  MacroBreakdown,
  TotalMacros,
} from "../../components/macro/types";

interface DailyTotalsProps {
  calculatedValues: CalculatedValues;
  totalMacros: TotalMacros;
  /** Optional per-day sub-macro totals - sugars / fiber / fat subtypes.
   *  Rendered as a collapsible breakdown below the main P/C/F/kcal
   *  tiles. Only rows whose value the aggregator populated render
   *  (others were never seen in today's foods, so showing "0g" would
   *  mislead). When the whole object is empty, the breakdown row is
   *  hidden entirely. */
  breakdown?: MacroBreakdown;
  /** Displayed day + today's key. Used to fire the one-shot "calorie
   *  target met" celebration only while viewing today — never when
   *  scrolling back to a past day that already crossed its target. */
  selectedDate: string;
  today: string;
}

const GOAL_CELEBRATION_PREFIX = "maqro:goal:reached:";

/** One-shot "you hit today's calorie target" celebration, keyed by day in
 *  localStorage so it fires exactly once — not on every subsequent add, and
 *  not again after a reload. Mirrors the streak-milestone guard in
 *  StreakChip. Gated to today so reviewing a past day never re-fires it. */
function useGoalReachedCelebration(
  reached: boolean,
  isToday: boolean,
  dayKey: string,
): void {
  useEffect(() => {
    if (!isToday || !reached) return;
    const key = `${GOAL_CELEBRATION_PREFIX}${dayKey}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // Private mode: can't persist, so skip the toast too — otherwise it
      // would re-fire on every render with no flag to suppress it.
      return;
    }
    toast.success("🎯 Today's calorie target met", {
      description: "Nice work staying on plan.",
    });
  }, [reached, isToday, dayKey]);
}

const SUB_MACRO_LABELS: Record<keyof MacroBreakdown, string> = {
  sugars: "Sugars",
  addedSugars: "Added sugars",
  fiber: "Fiber",
  saturatedFat: "Saturated fat",
  transFat: "Trans fat",
  monoFat: "Mono-unsat. fat",
  polyFat: "Poly-unsat. fat",
};

type Row = {
  key: keyof TotalMacros;
  label: string;
  target: number;
  unit: string;
  cssVar?: string;
};

const DailyTotals: React.FC<DailyTotalsProps> = ({
  calculatedValues,
  totalMacros,
  breakdown,
  selectedDate,
  today,
}) => {
  const pct = (current: number, target: number) =>
    target === 0 ? 0 : Math.min(Math.round((current / target) * 100), 100);

  // The single most actionable number on the page: how many calories are
  // left against today's target. The tiles show consumed/target, which
  // forces the user to do the subtraction in their head — this does it for
  // them. Held back until the first food is logged so a brand-new day shows
  // the cold-start guidance below, not a lone "2,100 kcal left".
  const targetCalories = Math.round(calculatedValues.targetCalories);
  const consumedCalories = Math.round(totalMacros.calories);
  const remainingCalories = targetCalories - consumedCalories;
  const showRemaining = targetCalories > 0 && consumedCalories > 0;

  const goalReached = targetCalories > 0 && consumedCalories >= targetCalories;
  useGoalReachedCelebration(goalReached, selectedDate === today, today);

  const rows: Row[] = [
    {
      key: "protein",
      label: "Protein",
      target: calculatedValues.protein,
      unit: "g",
      cssVar: "--macro-protein",
    },
    {
      key: "carbs",
      label: "Carbs",
      target: calculatedValues.carbs,
      unit: "g",
      cssVar: "--macro-carbs",
    },
    {
      key: "fat",
      label: "Fat",
      target: calculatedValues.fat,
      unit: "g",
      cssVar: "--macro-fat",
    },
    {
      key: "calories",
      label: "kcal",
      target: calculatedValues.targetCalories,
      unit: "",
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Daily Totals
        </p>
        {/* Streak chip + Share button. The chip self-hides when
            the user has no active streak (current === 0), so the
            row stays clean for first-time and lapsed users. */}
        <div className="flex items-center gap-2">
          <StreakChip />
          <ShareTodayButton
            totalMacros={totalMacros}
            calculatedValues={calculatedValues}
          />
        </div>
      </div>
      {showRemaining && (
        <p className="mb-3 text-sm">
          {remainingCalories > 0 ? (
            <>
              <span className="font-semibold tabular-nums text-foreground">
                {remainingCalories.toLocaleString()}
              </span>{" "}
              <span className="text-muted-foreground">kcal left today</span>
            </>
          ) : remainingCalories === 0 ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              Daily target reached
            </span>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {Math.abs(remainingCalories).toLocaleString()}
              </span>{" "}
              <span className="text-muted-foreground">kcal over target</span>
            </>
          )}
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 sm:gap-x-4">
        {rows.map((row) => {
          const current = totalMacros[row.key];
          const p = pct(current, row.target);
          return (
            <div
              key={row.key}
              className="space-y-1.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {row.cssVar && (
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: `hsl(var(${row.cssVar}))` }}
                      aria-hidden
                    />
                  )}
                  <span className="text-xs font-medium text-foreground">
                    {row.label}
                  </span>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  / {row.target}
                  {row.unit}
                </span>
              </div>
              <p className="font-mono text-xl font-semibold tabular-nums text-foreground">
                <NumberTicker
                  value={current}
                  suffix={row.unit}
                />
              </p>
              <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${p}%`,
                    background: row.cssVar
                      ? `hsl(var(${row.cssVar}))`
                      : "hsl(var(--foreground))",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {breakdown && Object.keys(breakdown).length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
            Breakdown ({Object.keys(breakdown).length} sub-macro
            {Object.keys(breakdown).length === 1 ? "" : "s"})
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 font-mono tabular-nums sm:grid-cols-2">
            {(Object.keys(SUB_MACRO_LABELS) as Array<keyof MacroBreakdown>)
              .filter((k) => typeof breakdown[k] === "number")
              .map((k) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-2"
                >
                  <dt className="text-muted-foreground">
                    {SUB_MACRO_LABELS[k]}
                  </dt>
                  <dd className="text-foreground">{breakdown[k]} g</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
    </div>
  );
};

/** "Share today" affordance — builds a text card from the current
 *  daily totals and pushes it through the Web Share API. On
 *  desktop browsers that don't implement Web Share (Chrome
 *  desktop, Firefox), we fall back to copying the card to the
 *  clipboard and surfacing a toast.
 *
 *  The card itself is plain text — no image, no remote dependency.
 *  Shared content travels through the recipient's OS share sheet
 *  (Messages, WhatsApp, etc.), where rich-text image previews
 *  rarely render reliably anyway. A future iteration can layer in
 *  a Canvas-rendered image; for now the text card travels
 *  cleanly through every channel. */
function ShareTodayButton({
  totalMacros,
  calculatedValues,
}: {
  totalMacros: TotalMacros;
  calculatedValues: CalculatedValues;
}) {
  const [busy, setBusy] = useState(false);
  // Don't render the button before there's anything to share —
  // a card reading "0 / 2100 kcal" before the user logs their
  // first food is conversion-killing noise.
  if (totalMacros.calories === 0) return null;

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      // Two server round-trips: prepare (cheap JSON, returns
      // signed URLs) → fetch the PNG. The browser can't sign URLs
      // itself because the HMAC secret has to stay server-side;
      // the prepare endpoint is the one explicit signing surface
      // (see lib/share-badge-signing.ts for the opt-in model).
      const prepareParams = new URLSearchParams({
        kc: String(Math.round(totalMacros.calories)),
        kt: String(Math.round(calculatedValues.targetCalories)),
        pc: String(Math.round(totalMacros.protein)),
        pt: String(Math.round(calculatedValues.protein)),
        cc: String(Math.round(totalMacros.carbs)),
        ct: String(Math.round(calculatedValues.carbs)),
        fc: String(Math.round(totalMacros.fat)),
        ft: String(Math.round(calculatedValues.fat)),
      });
      const prepareRes = await fetch(
        `/api/share/today/prepare?${prepareParams.toString()}`,
        { cache: "no-store" },
      );
      if (!prepareRes.ok) {
        throw new Error(`Couldn't prepare the card (${prepareRes.status}).`);
      }
      const { imageUrl, pageUrl } = (await prepareRes.json()) as {
        imageUrl: string;
        pageUrl: string;
      };

      const imageRes = await fetch(imageUrl);
      if (!imageRes.ok) {
        throw new Error(`Couldn't build the card (${imageRes.status}).`);
      }
      const blob = await imageRes.blob();
      const file = new File([blob], "maqro-today.png", { type: "image/png" });

      // We intentionally do NOT pass a `text` field on any of the
      // share payloads. iOS's "Copy" action in the share sheet
      // concatenates `text` with `url` into the clipboard, which
      // pasted noise like "Today on Maqro 🥗\n1,576 / 1,682 kcal\n
      // P 230g · C 81g · F 25g\nhttps://maqro.app" everywhere the
      // user pasted it. The URL alone unfurls into the same
      // branded card via OG meta, so the textual summary was
      // redundant on top of being ugly. Recipients still see the
      // numbers via the unfurl; senders get a clean URL on
      // copy/paste.
      //
      // Tier 1: file + URL share via Web Share API. On platforms
      // that accept both, the file lands inline in photo targets
      // (Instagram Stories, WhatsApp) and the URL unfurls into a
      // card on link targets (Twitter, iMessage, Slack).
      const fullPayload = {
        files: [file],
        url: pageUrl,
        title: "Today on Maqro",
      };
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare(fullPayload)
      ) {
        await navigator.share(fullPayload);
        return;
      }

      // Tier 2: URL-only share. Some Safari versions accept URL
      // but reject file payloads; downgrading lets us still hit
      // the OS share sheet on those.
      const urlPayload = { url: pageUrl, title: "Today on Maqro" };
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare(urlPayload)
      ) {
        await navigator.share(urlPayload);
        return;
      }

      // Tier 3: copy the unfurl URL to the clipboard. Desktop
      // browsers without Web Share — the user pastes anywhere
      // and the platform unfurls the OG card preview.
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pageUrl);
        toast.success("Link copied — paste it anywhere.");
        return;
      }

      // Tier 4: image-to-clipboard. Last resort before the user
      // is forced to download a file.
      if (
        typeof navigator !== "undefined" &&
        typeof window.ClipboardItem !== "undefined" &&
        navigator.clipboard?.write
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        toast.success("Card copied — paste it anywhere.");
        return;
      }

      // Tier 5: download. The user gets the PNG on disk and can
      // attach manually wherever they like.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "maqro-today.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("Card downloaded.");
    } catch (err) {
      // The Web Share API rejects with AbortError when the user
      // dismisses the OS share sheet. Treat that as a no-op, not
      // a failure — surfacing a "share failed" toast for a
      // deliberate cancel is misleading.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(
        err instanceof Error ? `Share failed: ${err.message}` : "Share failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      disabled={busy}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 coarse:h-10 coarse:w-10"
      aria-label="Share today's macros"
      title="Share today's macros"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Share2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export default DailyTotals;
