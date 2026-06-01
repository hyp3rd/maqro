"use client";

import { CameraView } from "@/components/capture/CameraView";
import { uploadToSignedUrl } from "@/lib/capture/upload";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

type Props = {
  sessionId: string;
  /** Single-use signed PUT URL from Supabase Storage. */
  uploadUrl: string;
  /** ISO timestamp the session expires — shown in the UI so the user
   *  knows they have time before refreshing. */
  expiresAt: string;
};

type Phase =
  | { kind: "capture" }
  | { kind: "uploading" }
  | { kind: "submitting-barcode" }
  | { kind: "done"; what: "photo" | "barcode" }
  | { kind: "error"; message: string };

export function CapturePhoneClient({ sessionId, uploadUrl, expiresAt }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "capture" });

  async function handlePhoto(blob: Blob) {
    setPhase({ kind: "uploading" });
    try {
      await uploadToSignedUrl(uploadUrl, blob);
      // Notify the server so it marks the row + the laptop's poll
      // sees it. Done after the upload so the row is consistent.
      const res = await fetch(
        `/api/capture/${encodeURIComponent(sessionId)}/photo-done`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Server rejected (HTTP ${res.status}).`);
      }
      setPhase({ kind: "done", what: "photo" });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  async function handleBarcode(code: string) {
    setPhase({ kind: "submitting-barcode" });
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(sessionId)}/barcode`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Server rejected (HTTP ${res.status}).`);
      }
      setPhase({ kind: "done", what: "barcode" });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Submit failed.",
      });
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-6">
      <header className="mb-4">
        <h1 className="text-base font-semibold tracking-tight">Send capture</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Your laptop is waiting. Take a photo of your meal or scan a barcode —
          we&apos;ll send it back automatically.
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground/70">
          Session expires {new Date(expiresAt).toLocaleTimeString()}
        </p>
      </header>

      {phase.kind === "capture" && (
        <CameraView
          modes={["scan", "photo"]}
          onBarcode={handleBarcode}
          onManualBarcode={handleBarcode}
          onPhoto={handlePhoto}
        />
      )}

      {phase.kind === "uploading" && (
        <CenteredSpinner label="Uploading photo to your laptop…" />
      )}

      {phase.kind === "submitting-barcode" && (
        <CenteredSpinner label="Sending the barcode to your laptop…" />
      )}

      {phase.kind === "done" && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="text-sm font-medium">
            {phase.what === "photo" ? "Photo sent" : "Barcode sent"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            All set — return to your laptop to finish adding this to a meal. You
            can close this tab.
          </p>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="space-y-3 py-4">
          <p
            role="alert"
            className="text-sm text-destructive"
          >
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setPhase({ kind: "capture" })}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
