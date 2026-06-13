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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/auth/client-fetch";
import { haptic } from "@/lib/haptics";
import { useState } from "react";
import { Calendar, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/** Shared compose dialog — used for both "new email" (Compose
 *  button on the inbox page) and "reply" (button on the email
 *  detail page).
 *
 *  Why a single dialog: reply is just compose with `to` /
 *  `subject` / `inReplyTo` pre-filled. Two dialogs would mean two
 *  places to keep the validation + scheduled-send affordance in
 *  sync. The form fields stay editable in both modes so an
 *  operator can change the recipient or subject on a reply if they
 *  need to forward the thread.
 *
 *  Two-component split: the wrapper owns the `<Dialog open>` shell;
 *  the body mounts only while `open` is true. That gives us free
 *  state reset on close + a clean re-seed from props on the next
 *  open, without the setState-in-effect anti-pattern. */
export function ComposeEmailDialog(props: ComposeProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent className="max-w-lg">
        {props.open && <ComposeBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

type ComposeProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  /** Inbound email id when this is a reply. Sent through to the
   *  route, which adds In-Reply-To / References headers on the
   *  outbound for client-side threading. */
  inReplyTo?: string;
};

function ComposeBody({
  onOpenChange,
  initialTo = "",
  initialSubject = "",
  initialBody = "",
  inReplyTo,
}: ComposeProps) {
  const router = useRouter();
  // useState initializers seed once per mount; because the parent
  // only mounts this body while `open` is true, every reopen is a
  // fresh seed without any reset effect.
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReply = Boolean(inReplyTo);
  const canSend =
    to.trim().length > 0 &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    (!scheduleEnabled || scheduledAt.length > 0);

  async function send() {
    if (!canSend || busy) return;
    haptic("tap");
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        to: to
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        subject: subject.trim(),
        text: body.trim(),
        ...(inReplyTo ? { inReplyTo } : {}),
      };
      if (scheduleEnabled && scheduledAt) {
        // <input type="datetime-local"> emits a local-time string
        // without timezone — `new Date(s)` interprets it in the
        // browser's tz, which is what the operator picked. We
        // round-trip through Date so the wire format is canonical
        // UTC ISO, matching the API's expectation.
        const t = new Date(scheduledAt);
        if (Number.isNaN(t.getTime())) {
          throw new Error("Invalid schedule time.");
        }
        payload.scheduledAt = t.toISOString();
      }
      const res = await clientFetch("/api/admin/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `Send failed (${res.status})`);
      }
      const data = (await res.json()) as {
        id: string;
        scheduledAt: string | null;
      };
      toast.success(
        data.scheduledAt
          ? `Scheduled for ${new Date(data.scheduledAt).toLocaleString()}.`
          : isReply
            ? "Reply sent."
            : "Email sent.",
      );
      onOpenChange(false);
      // Push the operator to the outgoing list so they can verify
      // the send + see live status / cancel a scheduled message.
      router.push(`/admin/inbox/outgoing/${encodeURIComponent(data.id)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  // Bounds for the datetime-local input. Computed at render is
  // fine here — clamping a few minutes either way doesn't change
  // the UX, and `Date.now()` for clamps is the standard pattern.
  const minDate = localNowInput(60_000);
  const maxDate = localNowInput(30 * 24 * 60 * 60_000);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isReply ? "Reply" : "New email"}</DialogTitle>
        <DialogDescription>
          {isReply
            ? "Sent from the configured EMAIL_FROM; threading headers are added automatically."
            : "Composes via Resend. Multiple recipients: comma-separated."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label
            htmlFor="compose-to"
            className="text-xs font-medium text-muted-foreground"
          >
            To
          </Label>
          <Input
            id="compose-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="alice@example.com, bob@example.com"
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="compose-subject"
            className="text-xs font-medium text-muted-foreground"
          >
            Subject
          </Label>
          <Input
            id="compose-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="compose-body"
            className="text-xs font-medium text-muted-foreground"
          >
            Message
          </Label>
          <Textarea
            id="compose-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            disabled={busy}
            className="font-sans text-sm"
          />
        </div>

        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
              disabled={busy}
              className="h-3.5 w-3.5"
            />
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-foreground">Schedule for later</span>
          </label>
          {scheduleEnabled && (
            <div className="mt-2 space-y-1">
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={busy}
                // Browser-local time. Min: now + 1 minute (rounded
                // to the input's resolution). Max: 30 days out,
                // matching Resend's hard cap.
                min={minDate}
                max={maxDate}
              />
              <p className="text-[10px] text-muted-foreground">
                Cancellable from the Outgoing tab until Resend dispatches.
              </p>
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600"
          >
            {error}
          </p>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void send()}
          disabled={!canSend || busy}
          className="gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          {busy
            ? "Sending…"
            : scheduleEnabled
              ? "Schedule"
              : isReply
                ? "Send reply"
                : "Send"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Returns a string in the format the `<input type="datetime-local">`
 *  expects (`YYYY-MM-DDTHH:MM`), offset by `offsetMs` from now.
 *  Used to clamp the min / max attributes so the operator can't
 *  schedule into the past or beyond Resend's cap. */
function localNowInput(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
