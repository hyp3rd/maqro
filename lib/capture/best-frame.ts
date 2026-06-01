/** "Live capture" frame selection. Instead of taking a single tap-
 *  to-capture snapshot (which often catches the user mid-motion or
 *  mid-autofocus), we sample several frames over a short hold
 *  period, score each one for sharpness, and return the sharpest
 *  as a JPEG blob. The AI side gets a meaningfully better input on
 *  shaky handheld shots without the user doing anything different
 *  than holding the camera still.
 *
 *  Trade-offs:
 *
 *   - We score downscaled proxies (see lib/capture/sharpness.ts),
 *     so the per-frame work is ~3ms on phones. Total budget for a
 *     6-frame hold is dominated by the wait, not the scoring.
 *
 *   - We encode the best frame at the video's native resolution
 *     (not the scoring proxy) at high JPEG quality. The score
 *     ordering is what's transferable across resolutions — the
 *     encoded bytes need to be the real thing the AI sees.
 *
 *   - We deliberately don't compose multiple frames (HDR-style).
 *     The fanciest version of this is brilliant when it works and
 *     unrecoverable when it doesn't (ghosting from motion). The
 *     "pick the sharpest" version is monotonically better than
 *     single-shot and never worse. */
import { captureFrame } from "@/lib/capture/camera";
import { scoreFrameSharpness } from "@/lib/capture/sharpness";

export interface BestFrameOptions {
  /** How many candidate frames to sample. Each one costs a
   *  setTimeout + a getImageData + the Laplacian pass. 5–8 is the
   *  sweet spot — fewer doesn't move the needle, more taxes
   *  cheaper Androids without improving the result. */
  samples?: number;
  /** Total hold duration in milliseconds. Frames are sampled
   *  roughly evenly across this window. ~1500ms feels intentional
   *  ("hold steady") without being tedious. */
  holdMs?: number;
  /** Final JPEG quality for the encoded best frame. The default
   *  bumps from the photo-path's older 0.85 → 0.92 — the AI
   *  vision tier penalizes JPEG artifacts more than it pays for
   *  any byte savings here. */
  quality?: number;
  /** Optional progress callback fired after each frame is sampled,
   *  with `(sampleIndex, total)`. Lets the UI render a ring or
   *  countdown without owning its own timer. */
  onProgress?: (current: number, total: number) => void;
}

export interface BestFrameResult {
  blob: Blob;
  /** Sharpness score of the chosen frame. Useful for telemetry
   *  ("we ship sharper frames than single-shot") and for the
   *  caller to decide whether to nudge the user ("looks blurry,
   *  try again?") when scores are universally low. */
  score: number;
  /** All scores in capture order — exposed so tests can assert
   *  ordering without re-running the timing-sensitive sampler. */
  allScores: number[];
}

/** Capture multiple frames from a live video, score each one,
 *  return the sharpest as a JPEG blob. Caller must keep the video
 *  playing for the duration of `holdMs`. */
export async function captureBestFrame(
  video: HTMLVideoElement,
  opts: BestFrameOptions = {},
): Promise<BestFrameResult> {
  const samples = clampInt(opts.samples ?? 6, 2, 12);
  const holdMs = clampInt(opts.holdMs ?? 1500, 400, 5000);
  const quality = clampNumber(opts.quality ?? 0.92, 0.5, 1);

  // Even spacing between samples. Subtract one because we want
  // `samples-1` gaps across `holdMs`: e.g. 6 samples in 1500ms →
  // sample at 0, 300, 600, 900, 1200, 1500.
  const gapMs = samples > 1 ? holdMs / (samples - 1) : 0;

  // Capture all candidate frames first (as bitmaps), THEN score
  // them in a second pass. Sampling and scoring in lockstep would
  // hold the main thread during the scoring window and miss the
  // next visual moment we wanted to sample. Bitmap creation is
  // cheap (~1ms); the Laplacian is the expensive bit.
  const bitmaps: ImageBitmap[] = [];
  for (let i = 0; i < samples; i++) {
    if (i > 0) await wait(gapMs);
    if (video.videoWidth === 0 || video.videoHeight === 0) continue;
    try {
      // createImageBitmap on a <video> grabs the current frame as
      // a GPU-backed bitmap. Cheaper than canvas.toDataURL for the
      // intermediate "I just need pixels to score" use case.
      const bmp = await createImageBitmap(video);
      bitmaps.push(bmp);
    } catch {
      // If a single sample fails (paused, navigated away mid-hold,
      // etc.) we just skip it and keep going — the worst case
      // degrades to fewer samples, not a failed capture.
    }
    opts.onProgress?.(i + 1, samples);
  }

  if (bitmaps.length === 0) {
    // Couldn't get any frames. Fall back to a single direct
    // capture so the caller still gets something usable —
    // captureFrame throws a clean error if the video isn't ready.
    const blob = await captureFrame(video, quality);
    return { blob, score: 0, allScores: [] };
  }

  const scores = await Promise.all(
    bitmaps.map((bmp) => scoreFrameSharpness(bmp)),
  );
  let bestIndex = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[bestIndex]) bestIndex = i;
  }

  // Encode the chosen bitmap at the video's native resolution.
  // The bitmap was captured at videoWidth/Height, so drawing it
  // 1:1 preserves every pixel — no resampling.
  const best = bitmaps[bestIndex];
  const canvas = document.createElement("canvas");
  canvas.width = best.width;
  canvas.height = best.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(best, 0, 0);
  const blob = await canvasToJpegBlob(canvas, quality);

  for (const bmp of bitmaps) bmp.close();

  return { blob, score: scores[bestIndex], allScores: scores };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Frame encode failed")),
      "image/jpeg",
      quality,
    );
  });
}

function clampInt(n: number, min: number, max: number): number {
  const i = Math.round(n);
  return Math.max(min, Math.min(max, i));
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
