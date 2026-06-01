/** Thin wrapper around `navigator.mediaDevices.getUserMedia` that
 *  encapsulates the cross-browser quirks (rear-camera preference,
 *  iOS `playsInline`, sane defaults). Caller passes a `<video>`
 *  element ref; we attach the stream and return a cleanup function. */

export type StartCameraOptions = {
  video: HTMLVideoElement;
  /** Prefer the rear camera (better for both food photos and barcodes).
   *  Falls back automatically on devices with only a front camera. */
  facingMode?: "environment" | "user";
};

export type StartCameraResult =
  | { ok: true; stop: () => void; stream: MediaStream }
  | {
      ok: false;
      reason: "permission-denied" | "no-camera" | "unsupported" | "error";
      message: string;
    };

export async function startCamera(
  opts: StartCameraOptions,
): Promise<StartCameraResult> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    return {
      ok: false,
      reason: "unsupported",
      message: "Camera API isn't available in this browser.",
    };
  }
  try {
    // `advanced` is the only place the spec lets us request focus
    // modes. Browsers that don't understand a constraint just skip it,
    // so this stays graceful on desktops without focus motors. The
    // bumped 1920×1080 resolution gives the BarcodeDetector enough
    // pixels to resolve thin EAN bars from typical handheld distance -
    // 1280×720 worked on MacBook webcams but was borderline on phones,
    // where the camera frames the barcode much closer.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: opts.facingMode ?? "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [
          { focusMode: "continuous" },
        ] as unknown as MediaTrackConstraintSet[],
      },
      audio: false,
    });

    // iOS Safari refuses to play the video without these attributes -
    // setting them via the DOM rather than JSX so the helper works
    // regardless of how the caller declared the element.
    opts.video.setAttribute("playsinline", "true");
    opts.video.setAttribute("autoplay", "true");
    opts.video.setAttribute("muted", "true");
    opts.video.srcObject = stream;
    // `.play()` may reject on some browsers without a user gesture.
    // We've come from a click (the camera dialog open button), so it
    // should succeed; swallow rejection to avoid log noise.
    try {
      await opts.video.play();
    } catch {
      // Already playing, or autoplay-blocked - neither blocks us.
    }

    return {
      ok: true,
      stream,
      stop: () => {
        opts.video.pause();
        opts.video.srcObject = null;
        for (const track of stream.getTracks()) track.stop();
      },
    };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "NotAllowedError" || e.name === "SecurityError") {
      return {
        ok: false,
        reason: "permission-denied",
        message:
          "Camera permission was denied. Enable it in your browser settings and try again.",
      };
    }
    if (e.name === "NotFoundError" || e.name === "OverconstrainedError") {
      return {
        ok: false,
        reason: "no-camera",
        message: "No camera found on this device.",
      };
    }
    return {
      ok: false,
      reason: "error",
      message: e.message ?? "Failed to start the camera.",
    };
  }
}

/** Capture the current video frame as a JPEG blob. Quality is
 *  reasonable for AI vision (1280×720 ~ 80 KB at 0.85) - small
 *  enough to upload quickly, sharp enough for food identification.
 *
 *  Throws a readable error if the video hasn't received its first
 *  frame yet (videoWidth/Height === 0). iOS Safari is slow to deliver
 *  the first frame after `play()` resolves; calling captureFrame too
 *  soon would otherwise produce a 0×0 canvas and a confusing
 *  downstream failure. */
export async function captureFrame(
  video: HTMLVideoElement,
  quality = 0.85,
): Promise<Blob> {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    throw new Error(
      "Camera isn't ready yet. Wait a beat and tap the button again.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(video, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Frame encode failed")),
      "image/jpeg",
      quality,
    );
  });
}
