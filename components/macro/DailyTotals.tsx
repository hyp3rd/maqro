"use client";

import { StreakChip } from "@/components/macro/StreakChip";
import { MacroReadout } from "@/components/today/MacroReadout";
import { TodayGauge } from "@/components/today/TodayGauge";
import { relativeDay } from "@/lib/today/timeline";
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
   *  Rendered as a collapsible breakdown below the gauge. Only rows whose
   *  value the aggregator populated render (others were never seen in
   *  today's foods, so showing "0g" would mislead). When the whole object
   *  is empty, the breakdown is hidden entirely. */
  breakdown?: MacroBreakdown;
  /** Displayed day + today's key. Used to note "calorie target reached"
   *  only while viewing today — never when scrolling back to a past day
   *  that already crossed its target — and to word the gauge's centre
   *  ("left today" only makes sense for today; a past day came in "under
   *  target"; a future day has kcal "to plan"). `calculatedValues` is the
   *  DISPLAYED day's own target. */
  selectedDate: string;
  today: string;
}

const GOAL_CELEBRATION_PREFIX = "maqro:goal:reached:";

/** One-shot "today's calorie target reached" note, keyed by day in
 *  localStorage so it fires exactly once — not on every subsequent add, and
 *  not again after a reload. Mirrors the streak-milestone guard in
 *  StreakChip. Gated to today so reviewing a past day never re-fires it.
 *  A plain (neutral) toast stating the fact: reaching or passing the target
 *  is neither a success nor a failure (wellbeing rule). */
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
    toast("Today's calorie target reached");
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

/** The Today energy panel (Instrument): the ring gauge (eaten vs the
 *  displayed day's own target, with the three macro arcs) beside its mono
 *  readout, then the sub-macro breakdown, the logging streak and Share. The
 *  gauge's centre is the headline — how many kcal are left, worded for the
 *  day — and a polite live region, so logging food is announced. Over and
 *  under are stated, never judged. */
const DailyTotals: React.FC<DailyTotalsProps> = ({
  calculatedValues,
  totalMacros,
  breakdown,
  selectedDate,
  today,
}) => {
  const targetCalories = Math.round(calculatedValues.targetCalories);
  const consumedCalories = Math.round(totalMacros.calories);
  const isToday = selectedDate === today;
  const goalReached = targetCalories > 0 && consumedCalories >= targetCalories;
  useGoalReachedCelebration(goalReached, isToday, today);
  const breakdownKeys = (
    Object.keys(SUB_MACRO_LABELS) as Array<keyof MacroBreakdown>
  ).filter((k) => typeof breakdown?.[k] === "number");

  return (
    <section aria-label="Energy and macros">
      {/* Side by side from 22rem of panel (a 390 px phone and up). In a
          narrower panel the readout beside the gauge would squeeze its
          labels to an ellipsis, so the gauge centres above it: a 2 × 2
          readout while each cell still holds "Protein" and "160 g left"
          on one row (19.5rem, a 360 px phone), one column below that (a
          320 px phone). Keyed off the panel's own width, not the
          viewport, since the desktop columns size it too. */}
      <div className="@container">
        <div
          data-part="gauge-row"
          className="flex flex-col items-center gap-4 @min-[22rem]:flex-row sm:gap-6"
        >
          <TodayGauge
            eaten={totalMacros}
            targets={calculatedValues}
            when={relativeDay(selectedDate, today)}
            className="w-[10.5rem] sm:w-44"
          />
          <MacroReadout
            eaten={totalMacros}
            targets={calculatedValues}
            className="w-full gap-x-4 @min-[19.5rem]:grid-cols-2 @min-[22rem]:w-auto @min-[22rem]:min-w-0 @min-[22rem]:flex-1 @min-[22rem]:grid-cols-1"
          />
        </div>
      </div>
      {/* Always laid out at touch height, so Share arriving with the first
          logged food never shifts the timeline below. */}
      <div className="mt-2 flex min-h-touch-9 items-start justify-between gap-2">
        {breakdown && breakdownKeys.length > 0 ? (
          <details className="min-w-0 flex-1 text-label">
            <summary className="flex min-h-touch-9 cursor-pointer select-none items-center text-muted-foreground hover:text-foreground">
              Breakdown ({breakdownKeys.length} sub-macro
              {breakdownKeys.length === 1 ? "" : "s"})
            </summary>
            <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 font-mono text-xs tabular-nums sm:grid-cols-2">
              {breakdownKeys.map((k) => (
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
        ) : (
          <span />
        )}
        {/* The streak chip self-hides with no active streak, so the row
            stays clean for first-time and lapsed users. */}
        <div className="flex shrink-0 items-center gap-2">
          <StreakChip />
          <ShareTodayButton
            totalMacros={totalMacros}
            calculatedValues={calculatedValues}
          />
        </div>
      </div>
    </section>
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
        throw new Error("Couldn't prepare your share card. Please try again.");
      }
      const { imageUrl, pageUrl } = (await prepareRes.json()) as {
        imageUrl: string;
        pageUrl: string;
      };

      const imageRes = await fetch(imageUrl);
      if (!imageRes.ok) {
        throw new Error("Couldn't build your share card. Please try again.");
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
      className="inline-flex size-touch-9 items-center justify-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
