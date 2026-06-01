/** Barcode scanning engine selector.
 *
 *  Two implementations, one interface:
 *
 *  1. **Native** — `window.BarcodeDetector` when the browser actually
 *     supports EAN/UPC/EAN-8 (`getSupportedFormats()` includes them).
 *     Hardware-accelerated, basically free. Android Chrome, macOS
 *     Safari, Edge.
 *
 *  2. **zxing** — `@zxing/browser` (pure JS). Slower but works on any
 *     browser with a `<canvas>`. Loaded *dynamically* the first time
 *     it's needed, so users on browsers with a working native detector
 *     never pay the ~80 KB bundle cost.
 *
 *  Why a fallback at all: iOS Safari ships a `BarcodeDetector` that
 *  only supports `qr_code` on many real-world builds. Without zxing we
 *  end up scanning forever and reading nothing. Firefox doesn't ship
 *  the API at all. */
import type { Result } from "@zxing/library";

/** Common consumer-product barcode formats. EAN-13/UPC-A cover ~all of
 *  packaged groceries; EAN-8 for very small packages. We deliberately
 *  skip QR (it's a link, not a product) and Code 128 (warehouse stuff). */
const FORMATS = ["ean_13", "upc_a", "ean_8"] as const;

/** Frame sources accepted by `decodeFrame`. Internally we coerce
 *  everything to a canvas so both engines see the same input. */
export type FrameSource =
  | HTMLCanvasElement
  | HTMLImageElement
  | ImageBitmap
  | Blob;

/** Unified engine surface — CameraView only ever sees this. */
export type BarcodeEngine = {
  /** Whether this engine is native (BarcodeDetector) or zxing.
   *  Exposed mainly so the UI can show a tiny "using your phone's
   *  built-in scanner" / "using fallback decoder" hint if it wants
   *  to; functionally irrelevant. */
  readonly source: "native" | "zxing";
  /** Subscribe to live frames on an already-playing video element and
   *  fire `onDetect` once when the first product barcode is read.
   *  Returns a cleanup that stops the loop. */
  startLiveDetect(
    video: HTMLVideoElement,
    onDetect: (code: string) => void,
  ): () => void;
  /** One-shot decode of a captured frame (used by the "Tap to capture
   *  & scan" fallback button). Resolves to the decoded digits or null. */
  decodeFrame(source: FrameSource): Promise<string | null>;
};

export type BarcodeAvailability =
  | { kind: "ready"; engine: BarcodeEngine }
  | { kind: "unsupported"; reason: string };

// ─── Native ──────────────────────────────────────────────────────────

interface NativeDetector {
  detect(
    source:
      | HTMLVideoElement
      | HTMLCanvasElement
      | HTMLImageElement
      | ImageBitmap
      | OffscreenCanvas
      | ImageData
      | Blob,
  ): Promise<Array<{ rawValue: string; format: string }>>;
}
interface NativeDetectorCtor {
  new (options?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

let supportedFormatsPromise: Promise<readonly string[]> | null = null;

function fetchNativeSupportedFormats(): Promise<readonly string[]> {
  if (supportedFormatsPromise) return supportedFormatsPromise;
  if (typeof window === "undefined") {
    supportedFormatsPromise = Promise.resolve([]);
    return supportedFormatsPromise;
  }
  const Ctor = (window as unknown as { BarcodeDetector?: NativeDetectorCtor })
    .BarcodeDetector;
  if (!Ctor || typeof Ctor.getSupportedFormats !== "function") {
    supportedFormatsPromise = Promise.resolve([]);
    return supportedFormatsPromise;
  }
  supportedFormatsPromise = Ctor.getSupportedFormats().catch(() => []);
  return supportedFormatsPromise;
}

function nativeEngine(detector: NativeDetector): BarcodeEngine {
  return {
    source: "native",
    startLiveDetect(video, onDetect) {
      let handle = 0;
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const results = await detector.detect(video);
          const first = results[0]?.rawValue;
          if (first) {
            stopped = true;
            onDetect(first);
            return;
          }
        } catch {
          // Detector throws when the video isn't ready yet (no first
          // frame painted). Try again next animation frame.
        }
        if (!stopped) handle = requestAnimationFrame(tick);
      };
      handle = requestAnimationFrame(tick);
      return () => {
        stopped = true;
        cancelAnimationFrame(handle);
      };
    },
    async decodeFrame(source) {
      try {
        // Native detector accepts all our frame source types directly.
        const results = await detector.detect(
          source as Parameters<NativeDetector["detect"]>[0],
        );
        return results[0]?.rawValue ?? null;
      } catch {
        return null;
      }
    },
  };
}

// ─── zxing fallback ──────────────────────────────────────────────────

/** Lazy-loaded zxing reader instance. The actual module import happens
 *  inside `loadZxingReader` so users on browsers with a working native
 *  detector never pull in the 80 KB chunk. */
let zxingReaderPromise: Promise<{
  reader: import("@zxing/browser").BrowserMultiFormatOneDReader;
  // Imported lazily so we can use the types without the runtime cost
  // up-front. The Map below is built from these in `loadZxingReader`.
  Result: typeof import("@zxing/library").Result;
}> | null = null;

async function loadZxingReader() {
  if (!zxingReaderPromise) {
    zxingReaderPromise = (async () => {
      const [{ BrowserMultiFormatOneDReader }, lib] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const hints = new Map();
      hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
        lib.BarcodeFormat.EAN_13,
        lib.BarcodeFormat.UPC_A,
        lib.BarcodeFormat.EAN_8,
      ]);
      // Throw fewer false-negatives on slightly blurry frames.
      hints.set(lib.DecodeHintType.TRY_HARDER, true);
      return {
        reader: new BrowserMultiFormatOneDReader(hints),
        Result: lib.Result,
      };
    })();
  }
  return zxingReaderPromise;
}

async function zxingEngine(): Promise<BarcodeEngine> {
  const { reader } = await loadZxingReader();
  return {
    source: "zxing",
    startLiveDetect(video, onDetect) {
      let stopped = false;
      // decodeFromVideoElement subscribes to video frames and calls our
      // callback on every decode attempt (with either a Result or an
      // error). Returns a Promise<IScannerControls> we hold onto so we
      // can stop the loop.
      const controlsPromise = reader
        .decodeFromVideoElement(video, (result?: Result) => {
          if (stopped) return;
          if (result) {
            stopped = true;
            onDetect(result.getText());
            void controlsPromise.then((c) => c && c.stop()).catch(() => {});
          }
          // Ignore the error path — zxing reports NotFoundException on
          // every frame that doesn't contain a code, which is the
          // expected steady state.
        })
        .catch(() => null);
      return () => {
        stopped = true;
        void controlsPromise.then((c) => c && c.stop()).catch(() => {});
      };
    },
    async decodeFrame(source) {
      const canvas = await toCanvas(source);
      try {
        const result = reader.decodeFromCanvas(canvas);
        return result.getText();
      } catch {
        // zxing throws NotFoundException when nothing decodes. That's
        // expected — we treat it as "no code" rather than an error.
        return null;
      }
    },
  };
}

async function toCanvas(source: FrameSource): Promise<HTMLCanvasElement> {
  if (source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  if (source instanceof HTMLImageElement) {
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    ctx.drawImage(source, 0, 0);
    return canvas;
  }
  if (source instanceof ImageBitmap) {
    canvas.width = source.width;
    canvas.height = source.height;
    ctx.drawImage(source, 0, 0);
    return canvas;
  }
  // Blob → ImageBitmap → canvas.
  const bitmap = await createImageBitmap(source);
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

// ─── Public selector ──────────────────────────────────────────────────

/** Returns the best engine the browser can offer. Native if it
 *  actually supports product barcodes; zxing otherwise. SSR-safe
 *  (returns "unsupported" before hydration). */
export async function detectBarcodeAvailability(): Promise<BarcodeAvailability> {
  if (typeof window === "undefined") {
    return { kind: "unsupported", reason: "Server-side render" };
  }
  // 1) Try native.
  const Ctor = (window as unknown as { BarcodeDetector?: NativeDetectorCtor })
    .BarcodeDetector;
  if (Ctor) {
    const supported = await fetchNativeSupportedFormats();
    const usable = FORMATS.filter((f) => supported.includes(f));
    if (usable.length > 0) {
      return {
        kind: "ready",
        engine: nativeEngine(new Ctor({ formats: [...usable] })),
      };
    }
  }
  // 2) Native missing or only does QR — fall back to zxing.
  try {
    const engine = await zxingEngine();
    return { kind: "ready", engine };
  } catch (err) {
    return {
      kind: "unsupported",
      reason:
        err instanceof Error
          ? `Couldn't load the barcode decoder: ${err.message}`
          : "Couldn't load the barcode decoder.",
    };
  }
}

/** Validate a user-typed barcode (manual-entry input). Returns the
 *  cleaned code or `null` if invalid. Accepts EAN-8/12/13/14, the
 *  practical product range. */
export function normalizeManualBarcode(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}
