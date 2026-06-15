"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clientFetch } from "@/lib/auth/client-fetch";
import { pollCapture } from "@/lib/capture/poll";
import type {
  CaptureInitResponse,
  CapturePollResponse,
} from "@/lib/capture/types";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Smartphone } from "lucide-react";
import QRCode from "qrcode";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires when the phone finished a capture. The parent owns the
   *  downstream - for "barcode" look up via OFF, for "photo"
   *  download the blob and ship it to /api/identify-meal. */
  onCaptureReady: (result: CapturePollResponse & { ready: true }) => void;
};

type Phase =
  | { kind: "initializing" }
  | { kind: "waiting"; id: string; qrSvg: string; expiresAt: string }
  | { kind: "uploading" } // poll saw something - about to fire onCaptureReady
  | { kind: "error"; message: string };

export function PairPhoneDialog({ open, onOpenChange, onCaptureReady }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-md">
        {open && (
          <PairBody
            onCaptureReady={(payload) => {
              onCaptureReady(payload);
              onOpenChange(false);
            }}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PairBody({
  onCaptureReady,
  onClose,
}: {
  onCaptureReady: (payload: CapturePollResponse & { ready: true }) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "initializing" });
  // Latest-ref so the polling/init effect doesn't need the callback
  // in its deps and the parent isn't forced to memoize.
  const onCaptureReadyRef = useRef(onCaptureReady);
  useEffect(() => {
    onCaptureReadyRef.current = onCaptureReady;
  }, [onCaptureReady]);

  // Init + poll lifecycle. One pass per mount; the parent re-mounts us
  // via `open` toggling.
  useEffect(() => {
    const abort = new AbortController();
    let mounted = true;
    (async () => {
      try {
        const initRes = await clientFetch("/api/capture/init", {
          method: "POST",
        });
        if (!initRes.ok) {
          const data = (await initRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? "Couldn't start pairing. Please try again.",
          );
        }
        const init = (await initRes.json()) as CaptureInitResponse;
        // Build the QR. The URL is short (just the session id) - the
        // phone fetches the upload URL server-side on page render.
        const target = `${window.location.origin}/capture/${init.id}`;
        const qrSvg = await QRCode.toString(target, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 1,
          width: 256,
        });
        if (!mounted) return;
        setPhase({
          kind: "waiting",
          id: init.id,
          qrSvg,
          expiresAt: init.expiresAt,
        });

        // Start polling. pollCapture returns when the phone has
        // contributed something, the user cancels (abort), the
        // session expires (404), or 5 minutes pass.
        const result = await pollCapture(init.id, abort.signal);
        if (!mounted) return;
        if (result.kind === "ready" && result.payload.ready) {
          setPhase({ kind: "uploading" });
          // Best-effort cleanup of the row + Storage blob; we do this
          // before invoking the parent so it can use the data without
          // racing the delete. Fires-and-forgets so a 5xx doesn't
          // block the happy path.
          fetch(`/api/capture/${encodeURIComponent(init.id)}`, {
            method: "DELETE",
          }).catch(() => {});
          onCaptureReadyRef.current(result.payload);
        } else if (result.kind === "expired") {
          setPhase({
            kind: "error",
            message: "Pairing session expired. Refresh the QR and scan again.",
          });
        } else if (result.kind === "timeout") {
          setPhase({
            kind: "error",
            message: "Timed out waiting for your phone. Try again.",
          });
        }
        // result.kind === "aborted" → component is unmounting, nothing
        // to do.
      } catch (err) {
        if (!mounted) return;
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Pairing failed.",
        });
      }
    })();
    return () => {
      mounted = false;
      abort.abort();
    };
  }, []);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4" />
          Pair your phone
        </DialogTitle>
        <DialogDescription>
          Scan the QR with your phone&apos;s camera. We&apos;ll show what
          arrives back here.
        </DialogDescription>
      </DialogHeader>

      <div className="py-2">
        {phase.kind === "initializing" && (
          <CenteredSpinner label="Preparing pairing session…" />
        )}

        {phase.kind === "waiting" && (
          <div className="space-y-3">
            <div
              className="mx-auto flex w-full max-w-xs items-center justify-center rounded-md border border-border/60 bg-white p-3"
              // The QR comes from `qrcode` as an SVG string - safe to
              // inject because the input is server-controlled (a
              // sanitized URL) and the library doesn't emit script.
              dangerouslySetInnerHTML={{ __html: phase.qrSvg }}
            />
            <p className="text-center text-xs text-muted-foreground">
              Or open this URL on your phone:
            </p>
            <p className="break-all rounded-md bg-muted/50 px-3 py-2 text-center font-mono text-[11px]">
              {`${typeof window !== "undefined" ? window.location.origin : ""}/capture/${phase.id}`}
            </p>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Waiting for your phone…
            </p>
          </div>
        )}

        {phase.kind === "uploading" && (
          <CenteredSpinner label="Got it - processing the capture…" />
        )}

        {phase.kind === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>{phase.message}</p>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
        >
          {phase.kind === "error" ? "Close" : "Cancel"}
        </Button>
      </DialogFooter>
    </>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
