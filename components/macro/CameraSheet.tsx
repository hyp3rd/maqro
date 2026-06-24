"use client";

import type { ResolvedMealPhoto } from "@/app/api/identify-meal/route";
import { CameraView } from "@/components/capture/CameraView";
import type { DietPreference, Food } from "@/components/macro/types";
import { Button } from "@/components/ui/button";
import { useModalOverlay } from "@/hooks/use-modal-overlay";
import { clientFetch } from "@/lib/auth/client-fetch";
import { listCustomFoods } from "@/lib/db";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ChevronLeft, Loader2, Sparkles, X } from "lucide-react";

/** Full-screen camera sheet. Replaces the previous shadcn `Dialog`
 *  layout because the small modal cramped both the barcode reticle
 *  and the photo-framing area — full-screen is what every other
 *  camera-first app does and what users expect on mobile.
 *
 *  Implementation choice: a portalled fixed-position `<div>` on
 *  top of the app (z-[60], inset-0). We deliberately do NOT use
 *  Radix Dialog because:
 *
 *    - Radix's content wrapper applies max-width/centering classes
 *      that fight a "fill the viewport" layout.
 *    - We want a hardware-feeling escape (top-left × button +
 *      Escape key) without the modal-overlay's click-outside-to-
 *      close behaviour, which is a footgun on a viewport with no
 *      "outside" to click.
 *
 *  Why a `createPortal` to `document.body` instead of just `<div
 *  className="fixed">` inline: the camera button lives deep inside
 *  the app shell, and any ancestor with its own stacking context
 *  (a parent with `z-*`, `transform`, `filter`, `will-change`,
 *  `isolation`, …) would clip our `fixed inset-0` below the app's
 *  sibling chrome — top bar at z-30, bottom nav at z-40 — even
 *  though our z-index is numerically higher. Portalling to <body>
 *  sidesteps every nested stacking root in one move.
 *
 *  Focus + scroll: while open we lock body scroll and wire Escape
 *  to close. The camera teardown happens via `CameraView`'s
 *  unmount cleanup — no special handling needed here. */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether AI identification is wired (env + auth). When false,
   *  the Photo tab is hidden so the user isn't presented with a
   *  button that 503s. The barcode path always works (no AI). */
  aiAvailable: boolean;
  /** Which capture tab to open on. The guided Log-meal launcher uses
   *  this so "Scan barcode" and "Photo" land on the right mode instead
   *  of always defaulting to scan. Ignored when the mode isn't
   *  available (e.g. `photo` while `aiAvailable` is false). */
  initialMode?: "scan" | "photo";
  /** Hide the other capture tab and pin the sheet to `initialMode`. Used by
   *  the mealless Photo quick-capture (the FAB): a barcode scanned there has
   *  no target meal to log to and would silently seed the desktop-only inline
   *  form, so the Barcode tab must not be reachable from that entry. */
  lockMode?: boolean;
  /** Profile's diet preference — sent to /api/identify-meal so the
   *  seed catalog the AI sees matches the user's universe. */
  dietPreference?: DietPreference;
  /** Show a "Pair phone" footer link that lets the user delegate
   *  the capture to their phone. Only meaningful on desktop. */
  pairPhoneAvailable: boolean;
  onFoodPicked: (food: Food) => void;
  onMealPhotoResolved: (result: ResolvedMealPhoto) => void;
  onSwitchToPairPhone: () => void;
  /** When set, the top-left control becomes a "Back" affordance
   *  (returning to the guided Log-meal method step) instead of an
   *  outright close. Omitted when opened standalone (desktop Scan). */
  onBack?: () => void;
  /** Hitting the monthly AI cap renders an Upgrade button that calls this
   *  — the parent closes the sheet and opens the upgrade dialog (it can't
   *  stack inside this z-[60] portal). */
  onUpgrade?: () => void;
};

type Phase =
  | { kind: "capture" }
  | { kind: "looking-up"; code: string }
  | { kind: "identifying" }
  | { kind: "error"; message: string; isCap?: boolean };

export function CameraSheet({
  open,
  onOpenChange,
  aiAvailable,
  initialMode,
  lockMode,
  dietPreference,
  pairPhoneAvailable,
  onFoodPicked,
  onMealPhotoResolved,
  onSwitchToPairPhone,
  onBack,
  onUpgrade,
}: Props) {
  // Scroll-lock, Escape, focus-into-dialog + trap + restore — the shared
  // overlay contract. Nothing in here takes focus on its own on the happy
  // path, so the hook focuses the container itself and screen readers
  // announce "Camera"; closing returns focus to the launcher button.
  const containerRef = useRef<HTMLDivElement>(null);
  useModalOverlay(open, containerRef, () => onOpenChange(false));

  if (!open) return null;

  // Portal to `document.body` so the sheet escapes any nested
  // stacking context the camera button might live inside. Even
  // with z-[60], a parent with its own `z-*` (or `transform`,
  // `filter`, `will-change`, etc.) creates a new stacking root —
  // and our `fixed inset-0` would then clip below the app's
  // sibling chrome (top bar at z-30, bottom nav at z-40). The
  // portal sidesteps the whole problem; the sheet lands as a
  // direct child of <body>, where z-index is unambiguous.
  //
  // `typeof document` guard handles the SSR pass; the parent
  // returning `null` until `open` is already client-only state,
  // but we add this for defence-in-depth in case the component
  // is ever called from a server-side render path.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
    >
      <CameraSheetBody
        aiAvailable={aiAvailable}
        initialMode={initialMode}
        lockMode={lockMode}
        dietPreference={dietPreference}
        pairPhoneAvailable={pairPhoneAvailable}
        onBack={onBack}
        onClose={() => onOpenChange(false)}
        onPicked={(food) => {
          onFoodPicked(food);
          onOpenChange(false);
        }}
        onMealPhotoResolved={(result) => {
          onMealPhotoResolved(result);
          onOpenChange(false);
        }}
        onSwitchToPairPhone={() => {
          onSwitchToPairPhone();
          onOpenChange(false);
        }}
        onUpgrade={
          onUpgrade
            ? () => {
                onOpenChange(false);
                onUpgrade();
              }
            : undefined
        }
      />
    </div>,
    document.body,
  );
}

function CameraSheetBody({
  aiAvailable,
  initialMode,
  lockMode,
  dietPreference,
  pairPhoneAvailable,
  onBack,
  onClose,
  onPicked,
  onMealPhotoResolved,
  onSwitchToPairPhone,
  onUpgrade,
}: {
  aiAvailable: boolean;
  initialMode?: "scan" | "photo";
  lockMode?: boolean;
  dietPreference?: DietPreference;
  pairPhoneAvailable: boolean;
  onBack?: () => void;
  onClose: () => void;
  onPicked: (food: Food) => void;
  onMealPhotoResolved: (result: ResolvedMealPhoto) => void;
  onSwitchToPairPhone: () => void;
  onUpgrade?: () => void;
}) {
  const [resetKey, setResetKey] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "capture" });

  // `lockMode` pins the sheet to the requested tab (scan needs no AI; photo
  // does), hiding the switcher so a mealless Photo capture can't fall into a
  // barcode scan with nowhere to log it.
  const modes: Array<"scan" | "photo"> =
    lockMode && initialMode && (initialMode === "scan" || aiAvailable)
      ? [initialMode]
      : aiAvailable
        ? ["scan", "photo"]
        : ["scan"];

  async function lookupBarcode(code: string) {
    setPhase({ kind: "looking-up", code });
    try {
      const res = await fetch(`/api/off-barcode/${encodeURIComponent(code)}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error ?? "Couldn't look up that barcode. Please try again.",
        );
      }
      const data = (await res.json()) as { food?: Food };
      if (!data.food)
        throw new Error(
          "We couldn't find that barcode in Open Food Facts. Try entering the food by hand.",
        );
      onPicked(data.food);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Couldn't look up that barcode. Please try again.",
      });
    }
  }

  async function identifyMeal(blob: Blob) {
    setPhase({ kind: "identifying" });
    try {
      const base64 = await blobToBase64(blob);
      const customs = await listCustomFoods().catch(() => []);
      const res = await clientFetch("/api/identify-meal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mediaType: "image/jpeg",
          dietPreference,
          customFoods: customs.map((c) => ({
            name: c.name,
            protein: c.protein,
            carbs: c.carbs,
            fat: c.fat,
            calories: c.calories,
            category: c.category,
            subCategory: c.subCategory,
            brand: c.brand,
            dietKind: c.dietKind,
          })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          used?: number;
          cap?: number;
          kind?: string;
        };
        if (res.status === 402 || data.kind === "ai-cap-reached") {
          // A retry would deterministically 402 again — surface the cap with a
          // reset/upgrade hint and no doomed "Try again".
          setPhase({
            kind: "error",
            isCap: true,
            message:
              data.used != null && data.cap != null
                ? `You've used all your AI scans this month (${data.used}/${data.cap}). The limit resets on the 1st, or upgrade in Settings.`
                : "You've reached your monthly AI limit. It resets on the 1st, or upgrade in Settings.",
          });
          return;
        }
        throw new Error(
          data.error ??
            "We couldn't read that photo. Try again with better lighting.",
        );
      }
      const result = (await res.json()) as ResolvedMealPhoto;
      if (result.foods.length === 0) {
        throw new Error("No foods identified in the photo.");
      }
      onMealPhotoResolved(result);
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Identification failed.",
      });
    }
  }

  return (
    <>
      {/* Top-left control. In the guided Log-meal flow it's a "Back"
          that returns to the method step; standalone it's an outright
          close. Safe-area padded so the notch doesn't eat the target. */}
      <button
        type="button"
        onClick={onBack ?? onClose}
        aria-label={onBack ? "Back" : "Close camera"}
        // Arbitrary `top-[calc(...)]` rather than a new utility:
        // we use this expression in exactly one place and adding
        // a `top-safe-plus-2` to globals.css would mirror the
        // existing `pt-*` flavor for one consumer. Keep globals.css
        // honest until a third caller appears.
        className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-20 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {onBack ? (
          <ChevronLeft className="h-5 w-5" />
        ) : (
          <X className="h-4 w-4" />
        )}
      </button>

      {phase.kind === "capture" && (
        <div className="relative flex h-full w-full flex-col pt-safe-plus-2">
          <CameraView
            key={resetKey}
            modes={modes}
            initialMode={initialMode}
            layout="fullscreen"
            onBarcode={lookupBarcode}
            onManualBarcode={lookupBarcode}
            onPhoto={identifyMeal}
          />
          {pairPhoneAvailable && (
            <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-10 text-center text-[11px] text-white/70">
              Better camera nearby?{" "}
              <button
                type="button"
                onClick={onSwitchToPairPhone}
                className="underline underline-offset-2 hover:text-white"
              >
                Pair your phone instead
              </button>
            </p>
          )}
        </div>
      )}

      {phase.kind === "looking-up" && (
        <CenteredSpinner label={`Looking up ${phase.code}…`} />
      )}

      {phase.kind === "identifying" && (
        <CenteredSpinner label="Identifying foods in your photo…" />
      )}

      {phase.kind === "error" && (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
          <div className="flex items-start gap-2 rounded-md border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{phase.message}</p>
          </div>
          <div className="flex gap-2">
            {!phase.isCap && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPhase({ kind: "capture" });
                  setResetKey((k) => k + 1);
                }}
              >
                Try again
              </Button>
            )}
            {phase.isCap && onUpgrade && (
              <Button
                type="button"
                variant="secondary"
                className="gap-1.5"
                onClick={onUpgrade}
              >
                <Sparkles className="h-4 w-4" />
                Upgrade
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-white/30 bg-transparent text-white hover:bg-white/10"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-white/80">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

/** Convert a Blob to a bare base64 string (no data: prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read frame."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read frame."));
    reader.readAsDataURL(blob);
  });
}
