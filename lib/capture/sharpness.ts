/** Sharpness scoring for camera frames via the variance of the
 *  Laplacian — the same metric OpenCV's blur-detection examples use.
 *  High variance = lots of edge response = sharp. Low variance =
 *  flat / blurry. We score multiple candidate frames during a
 *  "live capture" hold and pick the highest; this gets us a
 *  meaningfully better AI input on shaky handheld shots without
 *  asking the user to do anything different than "hold the camera
 *  steady for a moment."
 *
 *  Implementation notes:
 *
 *   - We downscale to ~320 px on the long edge before scoring. The
 *     Laplacian is O(N) but `getImageData` of a 1080p frame can
 *     stall the main thread for ~10ms on phones; the score is just
 *     a relative ranking, so a smaller proxy image is fine.
 *
 *   - Grayscale via the rec.709 luminance formula (0.2126 R +
 *     0.7152 G + 0.0722 B). The Laplacian operates on luminance;
 *     using a per-channel average produces noisier scores in
 *     coloured scenes.
 *
 *   - 3×3 Laplacian kernel `[[0,1,0],[1,-4,1],[0,1,0]]`. Edge pixels
 *     are skipped (no padding) — they'd require special handling
 *     and contribute < 1% of the score on any reasonably-sized image.
 *
 *  This module is browser-only because it relies on `OffscreenCanvas`
 *  / `HTMLCanvasElement`. Vitest's happy-dom env provides both. */

/** Maximum dimension (long edge) we downscale to before scoring.
 *  Bigger = more accurate score but slower per-frame. 320 keeps
 *  scoring under ~3ms on a Pixel 6a in our local timing.
 *  Exported for tests so a different value doesn't drift behavior. */
export const SCORE_PROXY_MAX_DIM = 320;

/** Score a frame's sharpness. Returns the variance of the
 *  3×3 Laplacian applied to the downscaled grayscale image.
 *  Higher = sharper. The absolute number isn't meaningful — only
 *  the ordering across frames captured at the same resolution. */
export async function scoreFrameSharpness(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | Blob,
): Promise<number> {
  const { width, height, data } = await readGrayscalePixels(source);
  if (width < 3 || height < 3) return 0;
  return laplacianVariance(data, width, height);
}

interface GrayscaleImage {
  width: number;
  height: number;
  /** Length = width * height, values 0–255. */
  data: Uint8ClampedArray;
}

async function readGrayscalePixels(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | Blob,
): Promise<GrayscaleImage> {
  const { width, height, ctx, dispose } = await proxyContext(source);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
  }
  dispose();
  return { width, height, data: gray };
}

async function proxyContext(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | Blob,
): Promise<{
  width: number;
  height: number;
  ctx: CanvasRenderingContext2D;
  dispose: () => void;
}> {
  let srcW = 0;
  let srcH = 0;
  let drawable: CanvasImageSource;
  let createdBitmap: ImageBitmap | null = null;

  if (source instanceof Blob) {
    const bmp = await createImageBitmap(source);
    createdBitmap = bmp;
    drawable = bmp;
    srcW = bmp.width;
    srcH = bmp.height;
  } else if (
    typeof ImageBitmap !== "undefined" &&
    source instanceof ImageBitmap
  ) {
    drawable = source;
    srcW = source.width;
    srcH = source.height;
  } else if (source instanceof HTMLVideoElement) {
    drawable = source;
    srcW = source.videoWidth;
    srcH = source.videoHeight;
  } else {
    drawable = source;
    srcW = source.width;
    srcH = source.height;
  }
  if (srcW === 0 || srcH === 0) {
    throw new Error("Source has no dimensions.");
  }

  const scale = Math.min(1, SCORE_PROXY_MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(3, Math.round(srcW * scale));
  const h = Math.max(3, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(drawable, 0, 0, w, h);
  return {
    width: w,
    height: h,
    ctx,
    dispose: () => {
      if (createdBitmap) createdBitmap.close();
    },
  };
}

/** Variance of the 3×3 Laplacian applied to the grayscale image.
 *  Edge pixels are skipped — including them would require either
 *  zero-padding (which inflates the variance with fake edges) or
 *  reflection-padding (slower, no real accuracy gain at this proxy
 *  size). Pure function so tests can construct synthetic images
 *  and assert known ordering. */
export function laplacianVariance(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        gray[i - width] +
        gray[i + width] +
        gray[i - 1] +
        gray[i + 1] -
        4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}
