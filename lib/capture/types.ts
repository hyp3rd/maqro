/** Shared types for the capture pairing flow. Kept in one module so
 *  the server routes, browser helpers, and React components agree on
 *  the wire shape without a circular import. */

export type CaptureKind = "photo" | "barcode";

/** Response from POST /api/capture/init — what the laptop needs to
 *  render the QR and start polling. */
export type CaptureInitResponse = {
  id: string;
  /** ISO timestamp the session expires (5 min from creation). UI shows
   *  "QR expires in N min". */
  expiresAt: string;
};

/** Response from GET /api/capture/[id]/urls — phone-side bootstrap.
 *  Re-minted on every call so the phone can refresh without breaking
 *  the signed URL. */
export type CaptureUrlsResponse = {
  /** Signed PUT URL for the phone to upload `<userId>/<id>.jpg` to.
   *  Single-use; expires when the session does. */
  photoUploadUrl: string;
  expiresAt: string;
};

/** Poll response from GET /api/capture/[id]. When `ready` flips true,
 *  `kind` tells the caller which path to take. */
export type CapturePollResponse =
  | { ready: false }
  | { ready: true; kind: "barcode"; barcode: string }
  | { ready: true; kind: "photo"; photoPath: string };
