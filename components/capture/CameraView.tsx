"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type BarcodeEngine,
  detectBarcodeAvailability,
  normalizeManualBarcode,
} from "@/lib/capture/barcode";
import { captureBestFrame } from "@/lib/capture/best-frame";
import { startCamera } from "@/lib/capture/camera";
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, ScanLine } from "lucide-react";

/** Live camera + barcode-detect surface. Supports two layouts:
 *
 *   - **Inline** (default): the video sits inside a 16:9 box with
 *     instructions and controls below. Used for the legacy modal
 *     and any non-full-screen host.
 *
 *   - **Full-screen** (`layout="fullscreen"`): the video fills the
 *     entire host (which the parent makes viewport-sized). Photo
 *     mode is edge-to-edge for max framing room; barcode mode adds
 *     a centered reticle overlay so the user knows where to point.
 *     Controls float at the bottom with a translucent backdrop.
 *
 *  Photo mode uses **multi-frame "live capture"** —
 *  [lib/capture/best-frame.ts](../../lib/capture/best-frame.ts)
 *  samples 6 frames over 1.5 s, scores each with a Laplacian-
 *  variance sharpness metric, and sends the sharpest to the AI.
 *  Single-shot capture caught the user mid-motion too often. */

type Mode = "scan" | "photo";
type Layout = "inline" | "fullscreen";

type Props = {
  /** Which capture modes the host wants to expose. */
  modes?: ReadonlyArray<Mode>;
  /** Default tab when `modes` includes both. */
  initialMode?: Mode;
  /** Layout: inline (legacy 16:9 box) or fullscreen (video fills
   *  parent). The parent owns the actual container sizing — this
   *  prop only flips internal class names. */
  layout?: Layout;
  /** Fires once with the decoded barcode (digits only). */
  onBarcode: (code: string) => void;
  /** Manual-entry fallback when BarcodeDetector + zxing both fail. */
  onManualBarcode?: (code: string) => void;
  /** Fires with the chosen best JPEG frame after a multi-frame
   *  capture. Caller handles upload / AI identification. */
  onPhoto?: (blob: Blob) => void;
};

type Phase =
  | { kind: "starting" }
  | { kind: "scanning"; stream: MediaStream; stop: () => void }
  | { kind: "manual"; reason: string }
  | { kind: "error"; message: string };

export function CameraView({
  modes = ["scan"],
  initialMode,
  layout = "inline",
  onBarcode,
  onManualBarcode,
  onPhoto,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [mode, setMode] = useState<Mode>(initialMode ?? modes[0] ?? "scan");
  /** Photo-capture state machine:
   *    'idle'       → ready to tap "Capture"
   *    'capturing'  → multi-frame hold in progress; user must stay still
   *    'done'       → we've handed the blob to the caller; component
   *                   will likely unmount next, but if not we want the
   *                   button disabled to avoid a double-tap re-fire. */
  const [photoStatus, setPhotoStatus] = useState<"idle" | "capturing" | "done">(
    "idle",
  );
  const [captureProgress, setCaptureProgress] = useState(0);
  // Single-shot "Capture & scan" fallback for barcode mode.
  const [manualScanBusy, setManualScanBusy] = useState(false);
  const [manualScanFailed, setManualScanFailed] = useState(false);
  const [detectorAvailable, setDetectorAvailable] = useState<boolean | null>(
    null,
  );
  const engineRef = useRef<BarcodeEngine | null>(null);
  const [engineSource, setEngineSource] = useState<"native" | "zxing" | null>(
    null,
  );
  const onBarcodeRef = useRef(onBarcode);
  useEffect(() => {
    onBarcodeRef.current = onBarcode;
  }, [onBarcode]);
  const onPhotoRef = useRef(onPhoto);
  useEffect(() => {
    onPhotoRef.current = onPhoto;
  }, [onPhoto]);
  const cleanupRef = useRef<() => void>(() => {});
  const stopScanRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const availability = await detectBarcodeAvailability();
      if (cancelled) return;
      const ready = availability.kind === "ready";
      setDetectorAvailable(ready);
      engineRef.current = ready ? availability.engine : null;
      setEngineSource(ready ? availability.engine.source : null);
      if (!ready && modes.length === 1 && modes[0] === "scan") {
        setPhase({
          kind: "manual",
          reason:
            availability.kind === "unsupported"
              ? availability.reason
              : "Live scanning isn't supported here.",
        });
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      const result = await startCamera({ video, facingMode: "environment" });
      if (cancelled) {
        if (result.ok) result.stop();
        return;
      }
      if (!result.ok) {
        setPhase({ kind: "error", message: result.message });
        return;
      }
      cleanupRef.current = () => {
        stopScanRef.current();
        result.stop();
      };
      setPhase({
        kind: "scanning",
        stream: result.stream,
        stop: cleanupRef.current,
      });
    })();
    return () => {
      cancelled = true;
      cleanupRef.current();
    };
  }, [modes]);

  useEffect(() => {
    if (phase.kind !== "scanning") return;
    if (mode !== "scan") {
      stopScanRef.current();
      stopScanRef.current = () => {};
      return;
    }
    if (detectorAvailable !== true) return;
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) return;
    const stop = engine.startLiveDetect(video, (code) => {
      cleanupRef.current();
      onBarcodeRef.current(code);
    });
    stopScanRef.current = stop;
    return stop;
  }, [mode, phase.kind, detectorAvailable]);

  async function handleManualScan() {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine || manualScanBusy) return;
    setManualScanBusy(true);
    setManualScanFailed(false);
    try {
      // Snap a single best-of-N frame for the engine to decode.
      // BarcodeDetector needs a sharp frame more than the AI does —
      // a blurry photo of a meal is still recognizable; a blurry
      // EAN barcode is unreadable. So we reuse the same multi-frame
      // sampler here, but with a shorter hold (the user is already
      // holding steady against a barcode, not framing a meal).
      const { blob } = await captureBestFrame(video, {
        samples: 4,
        holdMs: 600,
        quality: 0.95,
      });
      const code = await engine.decodeFrame(blob);
      if (code) {
        cleanupRef.current();
        onBarcodeRef.current(code);
        return;
      }
      setManualScanFailed(true);
    } catch {
      setManualScanFailed(true);
    } finally {
      setManualScanBusy(false);
    }
  }

  async function handleCapturePhoto() {
    const video = videoRef.current;
    if (!video || photoStatus !== "idle") return;
    setPhotoStatus("capturing");
    setCaptureProgress(0);
    try {
      const { blob } = await captureBestFrame(video, {
        samples: 6,
        holdMs: 1500,
        quality: 0.92,
        onProgress: (current, total) => setCaptureProgress(current / total),
      });
      cleanupRef.current();
      setPhotoStatus("done");
      onPhotoRef.current?.(blob);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to capture frame.",
      });
      setPhotoStatus("idle");
    }
  }

  const showTabs = modes.length > 1;
  const showManualEntry =
    phase.kind === "scanning" && mode === "scan" && detectorAvailable === false;
  const isFullscreen = layout === "fullscreen";

  // Container + video classes diverge between layouts. The
  // fullscreen variant lets the video fill the parent host (which
  // the parent makes viewport-sized); the inline variant keeps the
  // 16:9 box that suits the legacy embedded dialog.
  const containerClass = isFullscreen
    ? "relative flex h-full w-full flex-col bg-black text-white"
    : "space-y-3";
  const videoBoxClass = isFullscreen
    ? "relative flex-1 overflow-hidden bg-black"
    : "relative aspect-video w-full overflow-hidden rounded-md border border-border/60 bg-black";

  return (
    <div className={containerClass}>
      {showTabs && phase.kind !== "manual" && (
        <ModeTabs
          modes={modes}
          mode={mode}
          onChange={setMode}
          layout={layout}
        />
      )}

      <div className={videoBoxClass}>
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />

        {phase.kind === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Starting camera…
          </div>
        )}

        {/* Barcode reticle. A dark mask with a centered cutout
            focuses the user's attention on the scan region without
            actually constraining the detector (which still gets
            the full frame — cropping to the cutout would just hurt
            the recovery rate when the user aims slightly off). */}
        {phase.kind === "scanning" &&
          mode === "scan" &&
          detectorAvailable === true && (
            <BarcodeReticle
              showScanLine
              compact={!isFullscreen}
            />
          )}

        {/* Photo-capture overlay during the multi-frame hold.
            Shows a progress ring + "Hold steady" so the user
            knows to stay still for the duration. */}
        {phase.kind === "scanning" &&
          mode === "photo" &&
          photoStatus === "capturing" && (
            <CaptureHoldOverlay progress={captureProgress} />
          )}
      </div>

      {/* Controls strip. In fullscreen mode it sits over a dim
          backdrop at the bottom of the viewport; inline mode it's
          a regular block below the video. */}
      <div
        className={
          isFullscreen
            ? "pointer-events-auto bg-gradient-to-t from-black/80 via-black/50 to-transparent px-4 pb-safe-plus-2 pt-6"
            : "space-y-3"
        }
      >
        {phase.kind === "scanning" &&
          mode === "scan" &&
          detectorAvailable === true && (
            <ScanControls
              engineSource={engineSource}
              onManualScan={handleManualScan}
              busy={manualScanBusy}
              failed={manualScanFailed}
              fullscreen={isFullscreen}
            />
          )}

        {showManualEntry && (
          <ManualBarcodeEntry
            reason="Live scanning isn't supported in this browser. Type the digits below."
            onSubmit={(code) => (onManualBarcode ?? onBarcode)(code)}
          />
        )}

        {phase.kind === "scanning" && mode === "photo" && (
          <PhotoControls
            status={photoStatus}
            onCapture={handleCapturePhoto}
            fullscreen={isFullscreen}
          />
        )}

        {phase.kind === "error" && (
          <p
            role="alert"
            className={
              isFullscreen
                ? "text-center text-sm text-red-400"
                : "text-xs text-destructive"
            }
          >
            {phase.message}
          </p>
        )}

        {phase.kind === "manual" && (
          <ManualBarcodeEntry
            reason={phase.reason}
            onSubmit={(code) => (onManualBarcode ?? onBarcode)(code)}
          />
        )}
      </div>
    </div>
  );
}

function ModeTabs({
  modes,
  mode,
  onChange,
  layout,
}: {
  modes: ReadonlyArray<Mode>;
  mode: Mode;
  onChange: (next: Mode) => void;
  layout: Layout;
}) {
  // In fullscreen mode the tabs float over the top of the video
  // with a translucent dark chip — same as iOS Camera's mode
  // switcher. In inline mode they're a regular pill row.
  const wrapperClass =
    layout === "fullscreen"
      ? // Absolute-positioned chip floats over the video. The
        // parent sheet wraps the whole component in a safe-area
        // padded container, so `top-3` reads as "just below the
        // notch", not over it.
        "absolute inset-x-0 top-3 z-10 mx-auto flex w-fit gap-1 rounded-full bg-black/60 p-1 backdrop-blur"
      : "flex gap-1 rounded-md border border-border/60 bg-muted/30 p-1";
  return (
    <div className={wrapperClass}>
      {modes.includes("scan") && (
        <ModeTabButton
          active={mode === "scan"}
          onClick={() => onChange("scan")}
          icon={<ScanLine className="h-3 w-3" />}
          label="Barcode"
          layout={layout}
        />
      )}
      {modes.includes("photo") && (
        <ModeTabButton
          active={mode === "photo"}
          onClick={() => onChange("photo")}
          icon={<Camera className="h-3 w-3" />}
          label="Photo"
          layout={layout}
        />
      )}
    </div>
  );
}

function ModeTabButton({
  active,
  onClick,
  icon,
  label,
  layout,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  layout: Layout;
}) {
  if (layout === "fullscreen") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
          active ? "bg-white text-black" : "text-white/80 hover:text-white"
        }`}
      >
        {icon}
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </button>
  );
}

/** Dark-mask overlay with a centered transparent cutout. The mask
 *  doesn't crop the scan input — it just signposts where to aim
 *  the barcode. Detector still receives the full video frame. */
function BarcodeReticle({
  showScanLine,
  compact,
}: {
  showScanLine: boolean;
  compact: boolean;
}) {
  // Reticle is wider than tall — product barcodes are landscape.
  // ~78% width × 28% height of the video box in fullscreen, scaled
  // down a bit for the inline variant so it doesn't overflow on
  // small modals.
  const widthPct = compact ? 70 : 78;
  const heightPct = compact ? 22 : 28;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0"
      aria-hidden
    >
      {/* Dim the area outside the cutout via four absolutely-
          positioned rectangles. CSS clip-path / SVG mask would
          read cleaner but both have spotty cross-browser support
          combined with `<video>` underneath, so we stack rects. */}
      <div
        className="absolute inset-x-0 top-0 bg-black/55"
        style={{ height: `${(100 - heightPct) / 2}%` }}
      />
      <div
        className="absolute inset-x-0 bottom-0 bg-black/55"
        style={{ height: `${(100 - heightPct) / 2}%` }}
      />
      <div
        className="absolute left-0 bg-black/55"
        style={{
          top: `${(100 - heightPct) / 2}%`,
          height: `${heightPct}%`,
          width: `${(100 - widthPct) / 2}%`,
        }}
      />
      <div
        className="absolute right-0 bg-black/55"
        style={{
          top: `${(100 - heightPct) / 2}%`,
          height: `${heightPct}%`,
          width: `${(100 - widthPct) / 2}%`,
        }}
      />
      {/* Reticle border + corner brackets. */}
      <div
        className="absolute"
        style={{
          left: `${(100 - widthPct) / 2}%`,
          top: `${(100 - heightPct) / 2}%`,
          width: `${widthPct}%`,
          height: `${heightPct}%`,
        }}
      >
        <div className="absolute inset-0 rounded-md ring-1 ring-white/40" />
        {/* Corner accents for a "scanner" feel. */}
        <CornerBracket position="tl" />
        <CornerBracket position="tr" />
        <CornerBracket position="bl" />
        <CornerBracket position="br" />
        {showScanLine && (
          <div className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 animate-pulse rounded-full bg-red-500/80 shadow-[0_0_12px_rgba(239,68,68,0.7)]" />
        )}
      </div>
    </div>
  );
}

function CornerBracket({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const placement = {
    tl: "left-0 top-0 border-l-2 border-t-2 rounded-tl-md",
    tr: "right-0 top-0 border-r-2 border-t-2 rounded-tr-md",
    bl: "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-md",
    br: "right-0 bottom-0 border-r-2 border-b-2 rounded-br-md",
  }[position];
  return (
    <span
      className={`absolute h-5 w-5 border-white/80 ${placement}`}
      aria-hidden
    />
  );
}

/** Progress ring + "Hold steady" hint shown during the multi-
 *  frame capture window. Renders inside the video box. */
function CaptureHoldOverlay({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress));
  const circumference = 2 * Math.PI * 28;
  const dashOffset = circumference * (1 - pct);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/30">
      <svg
        viewBox="0 0 64 64"
        className="h-16 w-16"
        aria-hidden
      >
        <circle
          cx="32"
          cy="32"
          r="28"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="4"
          fill="none"
        />
        <circle
          cx="32"
          cy="32"
          r="28"
          stroke="white"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 32 32)"
          className="transition-[stroke-dashoffset] duration-150 ease-out"
        />
      </svg>
      <p className="text-sm font-medium text-white">Hold steady…</p>
    </div>
  );
}

function ScanControls({
  engineSource,
  onManualScan,
  busy,
  failed,
  fullscreen,
}: {
  engineSource: "native" | "zxing" | null;
  onManualScan: () => void;
  busy: boolean;
  failed: boolean;
  fullscreen: boolean;
}) {
  return (
    <div className={fullscreen ? "space-y-2" : "space-y-2"}>
      <p
        className={`flex items-center justify-center gap-1.5 text-center text-xs ${fullscreen ? "text-white/80" : "text-muted-foreground"}`}
      >
        <ScanLine className="h-3.5 w-3.5" />
        Point at a product barcode — detection is automatic.
        {engineSource === "zxing" && (
          <span
            className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${fullscreen ? "bg-white/15 text-white/90" : "bg-muted text-foreground"}`}
            title="Your browser's built-in scanner doesn't support product barcodes — using a JS fallback decoder."
          >
            fallback
          </span>
        )}
      </p>
      <div className="flex flex-col items-center gap-1">
        <Button
          type="button"
          variant={fullscreen ? "secondary" : "outline"}
          size="sm"
          onClick={onManualScan}
          disabled={busy}
          className="gap-1.5"
        >
          <ScanLine className="h-3.5 w-3.5" />
          {busy ? "Reading frame…" : "Tap to capture & scan"}
        </Button>
        {failed && (
          <p
            role="status"
            className={`text-[11px] ${fullscreen ? "text-white/70" : "text-muted-foreground"}`}
          >
            No barcode found in that frame. Hold steady and try again.
          </p>
        )}
      </div>
    </div>
  );
}

function PhotoControls({
  status,
  onCapture,
  fullscreen,
}: {
  status: "idle" | "capturing" | "done";
  onCapture: () => void;
  fullscreen: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p
        className={`text-center text-xs ${fullscreen ? "text-white/80" : "text-muted-foreground"}`}
      >
        Frame the meal and tap the button — we&apos;ll hold for a moment to pick
        the sharpest frame.
      </p>
      {fullscreen ? (
        // iOS-style big round shutter button. The 1.5s hold means
        // the user expects "press → hold → released" feedback;
        // a normal Button feels too quick.
        <button
          type="button"
          onClick={onCapture}
          disabled={status !== "idle"}
          aria-label="Capture meal photo"
          className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/95 ring-4 ring-white/30 transition-transform active:scale-95 disabled:opacity-60"
        >
          <Camera className="h-7 w-7 text-black" />
        </button>
      ) : (
        <Button
          type="button"
          onClick={onCapture}
          disabled={status !== "idle"}
          className="gap-1.5"
        >
          <Camera className="h-3.5 w-3.5" />
          {status === "capturing" ? "Holding…" : "Take photo"}
        </Button>
      )}
    </div>
  );
}

function ManualBarcodeEntry({
  reason,
  onSubmit,
}: {
  reason: string;
  onSubmit: (code: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = normalizeManualBarcode(raw);
    if (!code) {
      setError("Enter 8–14 digits from the barcode below the bars.");
      return;
    }
    setError(null);
    onSubmit(code);
  }

  return (
    <form
      onSubmit={handle}
      className="space-y-2"
    >
      <p className="text-xs text-muted-foreground">{reason}</p>
      <Label
        htmlFor="manual-barcode"
        className="text-xs font-medium text-muted-foreground"
      >
        Type the barcode digits
      </Label>
      <Input
        id="manual-barcode"
        inputMode="numeric"
        pattern="[0-9]*"
        autoFocus
        value={raw}
        onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 14))}
        placeholder="e.g. 5901234123457"
        className="font-mono tabular-nums"
      />
      {error && (
        <p
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={raw.length < 8}
      >
        Look up
      </Button>
    </form>
  );
}
