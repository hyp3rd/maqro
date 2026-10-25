"use client";

import { useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { CalculatedValues, TotalMacros } from "./types";

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
export function ShareTodayButton({
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
