"use client";

import type { ResolvedPantryScan } from "@/app/api/identify-pantry/route";
import { CameraView } from "@/components/capture/CameraView";
import { Button } from "@/components/ui/button";
import { clientFetch } from "@/lib/auth/client-fetch";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Loader2, X } from "lucide-react";

/** Full-screen "snap your fridge/shelf" sheet for the pantry. A
 *  trimmed sibling of [CameraSheet](./CameraSheet.tsx): photo mode
 *  only (no barcode, no pair-phone), posts the frame to
 *  /api/identify-pantry, and hands the identified items to a review
 *  dialog via `onScanResolved`. Shares CameraSheet's proven
 *  portal-to-body + body-scroll-lock + Escape-to-close scaffolding so
 *  the overlay can't be clipped by the app's stacking contexts.
 *
 *  Why a separate component rather than a `mode` flag on CameraSheet:
 *  the two flows commit to different targets (a meal slot's foods vs
 *  the pantry list) and CameraSheet already juggles barcode + pair-
 *  phone + photo tabs; bolting a third output shape onto it would
 *  muddy a component that's already dense. The shared capture surface
 *  (`CameraView`) is the reused part. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanResolved: (result: ResolvedPantryScan) => void;
};

type Phase =
  | { kind: "capture" }
  | { kind: "identifying" }
  | { kind: "error"; message: string };

export function PantryScanSheet({ open, onOpenChange, onScanResolved }: Props) {
  useEffect(() => {
    if (!open) return;
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const prevHtmlOverflow = htmlEl.style.overflow;
    const prevBodyOverflow = bodyEl.style.overflow;
    htmlEl.style.overflow = "hidden";
    bodyEl.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      htmlEl.style.overflow = prevHtmlOverflow;
      bodyEl.style.overflow = prevBodyOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan pantry"
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
    >
      <PantryScanBody
        onClose={() => onOpenChange(false)}
        onScanResolved={(result) => {
          onScanResolved(result);
          onOpenChange(false);
        }}
      />
    </div>,
    document.body,
  );
}

function PantryScanBody({
  onClose,
  onScanResolved,
}: {
  onClose: () => void;
  onScanResolved: (result: ResolvedPantryScan) => void;
}) {
  const [resetKey, setResetKey] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "capture" });

  async function identify(blob: Blob) {
    setPhase({ kind: "identifying" });
    try {
      const base64 = await blobToBase64(blob);
      const res = await clientFetch("/api/identify-pantry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Scan failed (HTTP ${res.status})`);
      }
      const result = (await res.json()) as ResolvedPantryScan;
      if (result.items.length === 0) {
        throw new Error("No items identified. Try a clearer, closer shot.");
      }
      onScanResolved(result);
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Scan failed.",
      });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close scanner"
        className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-20 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <X className="h-4 w-4" />
      </button>

      {phase.kind === "capture" && (
        <div className="relative flex h-full w-full flex-col pt-safe-plus-2">
          <CameraView
            key={resetKey}
            modes={["photo"]}
            layout="fullscreen"
            // onBarcode is required by CameraView but unreachable in a
            // photo-only mode — a no-op satisfies the contract.
            onBarcode={() => {}}
            onPhoto={identify}
          />
          <p className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-10 px-6 text-center text-[11px] text-white/70">
            Point at a shelf or open fridge. We&apos;ll list what we see — you
            confirm before anything&apos;s saved.
          </p>
        </div>
      )}

      {phase.kind === "identifying" && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-white/80">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Identifying items in your photo…</span>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
          <div className="flex items-start gap-2 rounded-md border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{phase.message}</p>
          </div>
          <div className="flex gap-2">
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

/** Convert a Blob to a bare base64 string (no data: prefix). Mirrors
 *  the helper in CameraSheet. */
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
