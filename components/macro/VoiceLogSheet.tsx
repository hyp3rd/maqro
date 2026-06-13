"use client";

import type { ResolvedMealPhoto } from "@/app/api/identify-meal/route";
import type { DietPreference } from "@/components/macro/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/auth/client-fetch";
import { listCustomFoods } from "@/lib/db";
import {
  createRecognizer,
  isRecognitionSupported,
  type RecognitionErrorKind,
  type Recognizer,
} from "@/lib/voice/recognition";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
} from "lucide-react";

/** "Talk to log" sheet. The fastest path from "I just ate
 *  something" to "it's in my meal plan."
 *
 *  Flow:
 *    1. **Idle.** Big mic button. Tap → recording.
 *    2. **Recording.** Live transcript appears as the user speaks.
 *       Tap again (or the Stop control) → finalizes.
 *    3. **Review transcript.** Editable textarea so the user can
 *       fix mishears before sending to the AI. Tap Send → parse.
 *    4. **Parsing.** Spinner while `/api/voice-log` runs.
 *    5. **Resolved.** Hands the same `ResolvedMealPhoto` shape
 *       the meal-photo flow produces to the parent, which mounts
 *       `MealPhotoReviewDialog`. The two flows share that review
 *       UI exactly — no per-source variant.
 *    6. **Error.** Surfaced with a Retry that drops us back to
 *       idle without losing the typed transcript.
 *
 *  Graceful degradation: when the browser doesn't expose
 *  SpeechRecognition (Firefox, older Edge), we skip phase 2
 *  entirely and start in phase 3 — the user types instead of
 *  speaking. Same downstream code, just no mic. */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether AI is wired (env + auth). When false, this sheet
   *  shouldn't even be reachable; we double-check anyway and
   *  render a clear explainer. */
  aiAvailable: boolean;
  /** Profile diet preference — passed to the AI for context but
   *  not enforced as a filter (the user is logging what they
   *  actually ate). */
  dietPreference?: DietPreference;
  /** Fires once the AI returns a parsed result; parent opens
   *  `MealPhotoReviewDialog` with it. */
  onResolved: (result: ResolvedMealPhoto) => void;
  /** When set, shows a back affordance returning to the guided
   *  Log-meal method step. Omitted when opened standalone (desktop
   *  Talk button). */
  onBack?: () => void;
  /** Hitting the monthly AI cap renders an Upgrade button that calls
   *  this — the parent closes the sheet and opens the upgrade dialog. */
  onUpgrade?: () => void;
};

type Phase =
  | { kind: "idle" }
  | { kind: "recording"; transcript: string }
  | { kind: "review"; transcript: string }
  | { kind: "parsing" }
  | {
      kind: "error";
      message: string;
      previousTranscript: string;
      isCap?: boolean;
    };

export function VoiceLogSheet({
  open,
  onOpenChange,
  aiAvailable,
  dietPreference,
  onResolved,
  onBack,
  onUpgrade,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-lg">
        {open && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="absolute left-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent active:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {open && (
          <VoiceLogBody
            aiAvailable={aiAvailable}
            dietPreference={dietPreference}
            onResolved={(r) => {
              onResolved(r);
              onOpenChange(false);
            }}
            onClose={() => onOpenChange(false)}
            onUpgrade={
              onUpgrade
                ? () => {
                    onOpenChange(false);
                    onUpgrade();
                  }
                : undefined
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VoiceLogBody({
  aiAvailable,
  dietPreference,
  onResolved,
  onClose,
  onUpgrade,
}: {
  aiAvailable: boolean;
  dietPreference?: DietPreference;
  onResolved: (r: ResolvedMealPhoto) => void;
  onClose: () => void;
  onUpgrade?: () => void;
}) {
  // We snapshot supported-ness at mount; if SpeechRecognition was
  // missing, we skip straight to the typing flow. We don't try
  // to detect support per-phase because the spec doesn't disappear
  // mid-session.
  const supported = useRecognitionSupportSnapshot();
  const [phase, setPhase] = useState<Phase>(
    supported ? { kind: "idle" } : { kind: "review", transcript: "" },
  );

  // The active recognizer instance. `null` outside the recording
  // phase — we mint a fresh one each session so stale callbacks
  // can't leak across recordings.
  const recognizerRef = useRef<Recognizer | null>(null);
  // True between the moment we call `stopRecording()` and the
  // recognizer's `onEnd` firing. Lets us distinguish a USER-
  // initiated abort (silent transition to review) from a
  // PLATFORM-initiated abort (real error — e.g. Brave blocking
  // Web Speech, network failure, OS denying the mic on a second
  // session). Without this flag, both paths read as `aborted` in
  // the error handler and silently dropped the user into an
  // empty review state — what looked like "opens and closes
  // instantly". */
  const userInitiatedStopRef = useRef(false);
  useEffect(() => {
    return () => {
      // Component unmount or sheet close → make sure the mic
      // is released. The recognizer's own `onend` already fires
      // on stop, but if the user backgrounds the tab mid-record
      // the browser keeps the mic active until we explicitly
      // tear it down. Marking this as user-initiated keeps the
      // teardown silent (no toast on close).
      userInitiatedStopRef.current = true;
      recognizerRef.current?.stop();
      recognizerRef.current = null;
    };
  }, []);

  function startRecording() {
    // Tear down any prior recognizer BEFORE creating a new one.
    // iOS Safari treats SpeechRecognition as a singleton resource:
    // a second `start()` while an old recognizer is still alive
    // triggers an immediate `aborted` error on the new one, which
    // is exactly the "starts and stops in sequence" symptom we
    // saw on the second attempt. Marking this as user-initiated
    // so the abort from teardown doesn't surface as a toast.
    if (recognizerRef.current) {
      userInitiatedStopRef.current = true;
      recognizerRef.current.stop();
      recognizerRef.current = null;
    }
    // Fresh recording → reset the "we're stopping" flag so a
    // platform-side abort on this new session WILL surface as
    // a real error.
    userInitiatedStopRef.current = false;
    const rec = createRecognizer({
      onInterim: (t) => {
        setPhase((prev) =>
          prev.kind === "recording"
            ? { kind: "recording", transcript: t }
            : prev,
        );
      },
      onFinal: (t) => {
        setPhase({ kind: "review", transcript: t });
      },
      onError: (kind, message) => {
        // `aborted` only counts as silent if WE initiated it
        // (user tapped Stop, sheet closed, switching recordings).
        // If the platform aborted on its own — Brave blocking
        // Web Speech, the OS denying mic mid-session, a network
        // disconnect — surface it as an error so the user sees
        // WHY it failed instead of an empty review state.
        if (kind === "aborted" && userInitiatedStopRef.current) return;
        setPhase({
          kind: "error",
          message: humanizeError(kind, message),
          previousTranscript: "",
        });
      },
      onEnd: () => {
        recognizerRef.current = null;
        userInitiatedStopRef.current = false;
        // Safety net: only transition to "review" if we're still
        // in "recording" AND we have an interim transcript to
        // carry forward. An empty interim transcript means the
        // recognizer ended without ever capturing anything —
        // either because the platform refused (Brave) or because
        // start() failed silently. In those cases onError has
        // already moved us to the error phase; the empty-review
        // transition here would clobber that. The truthy-check
        // on `prev.transcript` prevents the clobber.
        setPhase((prev) => {
          if (prev.kind !== "recording") return prev;
          if (!prev.transcript) return prev;
          return { kind: "review", transcript: prev.transcript };
        });
      },
    });
    if (!rec) {
      // Edge case: recognizer was supported on mount but a later
      // race condition removed it. Bail to typing.
      setPhase({ kind: "review", transcript: "" });
      return;
    }
    recognizerRef.current = rec;
    setPhase({ kind: "recording", transcript: "" });
    rec.start();
  }

  function stopRecording() {
    // Mark this as a user-initiated stop BEFORE calling
    // recognizer.stop() so the resulting `aborted` callback
    // routes through the silent path. `onEnd` resets the flag.
    userInitiatedStopRef.current = true;
    recognizerRef.current?.stop();
  }

  async function submitTranscript(transcript: string) {
    setPhase({ kind: "parsing" });
    try {
      // Load custom foods at call time — same pattern as the
      // meal-photo flow. Keeps the AI's seed catalog in sync
      // with what the user has actually saved.
      const customs = await listCustomFoods().catch(() => []);
      const res = await clientFetch("/api/voice-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript,
          dietPreference,
          customFoods: customs.map((c) => ({
            name: c.name,
            protein: c.protein,
            carbs: c.carbs,
            fat: c.fat,
            calories: c.calories,
            category: c.category,
            subCategory: c.subCategory,
            brand: c.brand,
            dietKind: c.dietKind,
          })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          used?: number;
          cap?: number;
          kind?: string;
        };
        if (res.status === 402 || data.kind === "ai-cap-reached") {
          // A retry (re-record or re-type) hits the same capped route, so
          // surface the cap with a reset/upgrade hint and only a Close action.
          setPhase({
            kind: "error",
            isCap: true,
            previousTranscript: transcript,
            message:
              data.used != null && data.cap != null
                ? `You've used all your AI logs this month (${data.used}/${data.cap}). The limit resets on the 1st, or upgrade in Settings.`
                : "You've reached your monthly AI limit. It resets on the 1st, or upgrade in Settings.",
          });
          return;
        }
        throw new Error(data.error ?? `Parsing failed (HTTP ${res.status})`);
      }
      const result = (await res.json()) as ResolvedMealPhoto;
      if (result.foods.length === 0) {
        throw new Error(
          "We couldn't pull any foods out of that. Try rephrasing — naming the food and the rough portion helps.",
        );
      }
      onResolved(result);
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Couldn't parse the meal.",
        previousTranscript: transcript,
      });
    }
  }

  if (!aiAvailable) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Voice logging unavailable</DialogTitle>
          <DialogDescription>
            This instance doesn&apos;t have AI enabled, so voice meal logging
            isn&apos;t available. Contact the administrator to turn it on.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Mic className="h-4 w-4" />
          Talk to log
        </DialogTitle>
        <DialogDescription>
          {supported
            ? "Say what you ate — the AI parses it into foods + portions you can review before adding."
            : "Speech recognition isn't available in this browser. Type what you ate; the AI parses it the same way."}
        </DialogDescription>
      </DialogHeader>

      <div className="py-2">
        {phase.kind === "idle" && <IdleState onStart={startRecording} />}

        {phase.kind === "recording" && (
          <RecordingState
            transcript={phase.transcript}
            onStop={stopRecording}
          />
        )}

        {phase.kind === "review" && (
          <ReviewState
            initial={phase.transcript}
            supported={supported}
            onSubmit={submitTranscript}
            onCancel={onClose}
            onReRecord={
              supported ? () => setPhase({ kind: "idle" }) : undefined
            }
          />
        )}

        {phase.kind === "parsing" && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Parsing your meal…</span>
          </div>
        )}

        {phase.kind === "error" && (
          <ErrorState
            message={phase.message}
            isCap={phase.isCap}
            onUpgrade={onUpgrade}
            onRetry={() => {
              if (supported) setPhase({ kind: "idle" });
              else
                setPhase({
                  kind: "review",
                  transcript: phase.previousTranscript,
                });
            }}
            // "Type instead" is the escape hatch for cases where
            // the browser CLAIMS to support Web Speech but the
            // underlying service is unreachable (Brave by
            // default, privacy extensions, corporate proxies
            // blocking Google's speech servers). Without this,
            // the user is stuck in an error → retry → error
            // loop with no way to actually log a meal.
            onTypeInstead={() =>
              setPhase({ kind: "review", transcript: phase.previousTranscript })
            }
            onClose={onClose}
          />
        )}
      </div>
    </>
  );
}

function IdleState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <button
        type="button"
        onClick={onStart}
        // Big tap target matched to the iOS-style shutter in the
        // camera sheet — same hand position, different sensor.
        className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform active:scale-95"
        aria-label="Start recording"
      >
        <Mic className="h-8 w-8" />
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Tap and speak. e.g. &quot;200 grams of chicken breast, one cup of rice,
        and a banana.&quot;
      </p>
    </div>
  );
}

function RecordingState({
  transcript,
  onStop,
}: {
  transcript: string;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <button
        type="button"
        onClick={onStop}
        // Pulsing red ring signals live recording without animation
        // libraries. The actual button is rectangular (Stop), not
        // round, so it reads as different from the Start affordance.
        className="relative inline-flex h-20 w-20 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform active:scale-95"
        aria-label="Stop recording"
      >
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full bg-red-500/40"
        />
        <Square
          className="relative h-7 w-7"
          fill="currentColor"
        />
      </button>
      <div
        aria-live="polite"
        className="min-h-[3rem] w-full rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-center text-sm text-foreground"
      >
        {transcript || (
          <span className="text-muted-foreground">Listening…</span>
        )}
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        Tap the square to stop.
      </p>
    </div>
  );
}

function ReviewState({
  initial,
  supported,
  onSubmit,
  onCancel,
  onReRecord,
}: {
  initial: string;
  supported: boolean;
  onSubmit: (t: string) => void;
  onCancel: () => void;
  onReRecord?: () => void;
}) {
  const [text, setText] = useState(initial);
  const canSubmit = text.trim().length > 0;

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-muted-foreground">
        {supported ? "Transcript (edit if needed)" : "What did you eat?"}
      </label>
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 1000))}
        rows={4}
        placeholder={
          supported
            ? ""
            : "e.g. 200 grams of chicken breast, one cup of rice, and a banana."
        }
      />
      <p className="text-[11px] text-muted-foreground">
        {text.length}/1000 characters
      </p>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
        >
          Cancel
        </Button>
        {onReRecord && (
          <Button
            type="button"
            variant="outline"
            onClick={onReRecord}
            className="gap-1.5"
          >
            <Mic className="h-3.5 w-3.5" />
            Re-record
          </Button>
        )}
        <Button
          type="button"
          onClick={() => onSubmit(text.trim())}
          disabled={!canSubmit}
          className="gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          Parse meal
        </Button>
      </DialogFooter>
    </div>
  );
}

function ErrorState({
  message,
  isCap,
  onUpgrade,
  onRetry,
  onTypeInstead,
  onClose,
}: {
  message: string;
  isCap?: boolean;
  onUpgrade?: () => void;
  onRetry: () => void;
  /** Optional: drop the user into the textarea-typing variant
   *  of the review stage. Surfaced as a secondary button so a
   *  user whose browser keeps failing voice can still log a
   *  meal in the same dialog instead of bouncing back out. */
  onTypeInstead?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{message}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!isCap && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
          >
            Try again
          </Button>
        )}
        {isCap && onUpgrade && (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={onUpgrade}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Upgrade
          </Button>
        )}
        {!isCap && onTypeInstead && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onTypeInstead}
          >
            Type instead
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClose}
        >
          Close
        </Button>
      </div>
    </div>
  );
}

/** Cache the SpeechRecognition support check in a state slot so
 *  it's stable across re-renders without re-querying `window` on
 *  every paint. The check itself runs once via the lazy
 *  initialiser; SSR-safe because `isRecognitionSupported`
 *  short-circuits to false when `window` is undefined. */
function useRecognitionSupportSnapshot(): boolean {
  const [snap] = useState(() => isRecognitionSupported());
  return snap;
}

function humanizeError(kind: RecognitionErrorKind, message: string): string {
  switch (kind) {
    case "permission-denied":
      return "Microphone access was denied. Enable it in your browser settings and try again.";
    case "no-speech":
      return "We didn't catch anything. Tap the mic and speak a bit louder or closer to it.";
    case "audio-capture":
      return "No microphone detected. Make sure one's plugged in / enabled in your OS settings.";
    case "network":
      return "Speech recognition needs the network and we couldn't reach it. Check your connection.";
    case "aborted":
      return "Recording stopped before we got a transcript. Try again.";
    case "unknown":
    default:
      return message || "Voice recognition hit a snag. Try again.";
  }
}
