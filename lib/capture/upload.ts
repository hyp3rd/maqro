/** Upload a Blob to a Supabase Storage signed PUT URL.
 *
 *  Pulled into its own tiny module so the phone-side capture page can
 *  call it without dragging the full `@supabase/supabase-js` client
 *  into the bundle — the phone is unauthenticated; the signed URL
 *  contains all the auth it needs. */

const UPLOAD_TIMEOUT_MS = 60_000;

export async function uploadToSignedUrl(
  url: string,
  blob: Blob,
  contentType = "image/jpeg",
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "PUT",
      body: blob,
      headers: { "content-type": contentType },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Upload failed (${res.status}): ${body.slice(0, 200) || res.statusText}`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
