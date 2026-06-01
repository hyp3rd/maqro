/** Thin wrapper around the Web Speech Recognition API.
 *
 *  The Web Speech API isn't part of the standard DOM lib —
 *  vendor-prefixed `webkitSpeechRecognition` on Safari/Chrome,
 *  unprefixed on Edge/Chromium, missing entirely on Firefox.
 *  This module hides the cross-browser fanout behind a clean
 *  `start()` / `stop()` interface plus a callback for partial +
 *  final transcripts.
 *
 *  We treat recognition as best-effort:
 *
 *    - If the API isn't available, `createRecognizer()` returns
 *      `null` and the caller falls back to a plain `<textarea>`
 *      ("Type what you ate"). Better to ship the feature for
 *      every browser than gate the whole flow on a Firefox
 *      install. The fallback is the same shape (transcript →
 *      `/api/voice-log`) so the AI side doesn't care which path
 *      produced the text.
 *
 *    - Errors that come from the user denying microphone
 *      permission are surfaced distinctly so the UI can prompt
 *      a re-grant rather than just saying "something went wrong."
 *
 *  We expose the minimal slice of the spec the UI needs:
 *  interim results (live transcript while speaking), final
 *  result (commit to the input), and a single canonical error
 *  string. No grammars, no language picker for now — `en-US` is
 *  the default; the route prompt is English-anchored too. */

export type RecognitionErrorKind =
  | "permission-denied"
  | "no-speech"
  | "audio-capture"
  | "network"
  | "aborted"
  | "unknown";

export interface RecognitionEvents {
  /** Fires every ~200 ms with the running transcript while the
   *  user is speaking. The UI uses it to render a live caption
   *  so the user knows the mic is working. */
  onInterim: (text: string) => void;
  /** Fires once when the API decides the utterance is finished
   *  (typically ~2 s of silence). The text is the final
   *  transcript; the recognizer auto-stops after this. */
  onFinal: (text: string) => void;
  /** Fires on any unrecoverable error. After this fires, the
   *  recognizer is in the stopped state — `start()` can be
   *  called again to retry. */
  onError: (kind: RecognitionErrorKind, message: string) => void;
  /** Fires when the recognizer transitions to the stopped state
   *  for ANY reason — natural end (post `onFinal`), error
   *  (`onError`), explicit `stop()`/`abort()`, or platform-side
   *  termination. Critical for the UI: without it, a silent
   *  user who taps Stop on iOS can end up with the recognizer
   *  having ended but the UI still stuck in "recording" because
   *  no `onresult`/`onerror` ever fired. Always emitted after
   *  any of the other callbacks; idempotent — fires at most
   *  once per recognizer lifecycle. */
  onEnd: () => void;
}

export interface Recognizer {
  start(): void;
  /** Forceful stop. We never use the spec's non-abort `stop()`
   *  because on iOS it sometimes never delivers a final result
   *  (the recognizer thinks the utterance is still in
   *  progress) and the UI hangs. Abort terminates the audio
   *  stream immediately and fires `onEnd`. The last interim
   *  transcript is what the caller carries forward. */
  stop(): void;
}

/** Subset of the Web Speech API surface we actually call. Keeping
 *  it local means we don't need a `lib.webspeech.d.ts` shim or a
 *  third-party @types/dom-speech-recognition dep. */
interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((e: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface BrowserSpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionGlobals {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
}

/** Returns `true` if any flavour of SpeechRecognition is exposed
 *  on the current `window`. Caller uses this BEFORE rendering
 *  the mic affordance — when false, render the textarea
 *  fallback directly. */
export function isRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const g = window as unknown as SpeechRecognitionGlobals;
  return (
    typeof g.SpeechRecognition === "function" ||
    typeof g.webkitSpeechRecognition === "function"
  );
}

/** Build a recognizer wired to the supplied callbacks. Returns
 *  `null` when the API isn't available, so the caller can switch
 *  to the textarea fallback without a try/catch. */
export function createRecognizer(events: RecognitionEvents): Recognizer | null {
  if (typeof window === "undefined") return null;
  const g = window as unknown as SpeechRecognitionGlobals;
  const Ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = "en-US";
  // `continuous: false` → the recognizer auto-stops after the
  // first final result. That matches the UI flow ("hold the mic,
  // speak one utterance, see transcript, confirm") — chunked
  // continuous capture is overkill for a meal-logging interaction.
  rec.continuous = false;
  rec.interimResults = true;

  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result) continue;
      const alt = result[0];
      if (!alt) continue;
      if (result.isFinal) final += alt.transcript;
      else interim += alt.transcript;
    }
    if (final) events.onFinal(final.trim());
    else if (interim) events.onInterim(interim.trim());
  };

  rec.onerror = (e) => {
    // Map the raw error codes the spec defines to our
    // RecognitionErrorKind so the UI doesn't have to know the
    // vendor strings.
    const kind: RecognitionErrorKind =
      e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "permission-denied"
        : e.error === "no-speech"
          ? "no-speech"
          : e.error === "audio-capture"
            ? "audio-capture"
            : e.error === "network"
              ? "network"
              : e.error === "aborted"
                ? "aborted"
                : "unknown";
    events.onError(kind, e.message ?? e.error);
  };

  // Latch so `onend` fires the consumer callback at most once
  // per lifecycle. The native event sometimes double-fires on
  // iOS Safari (once for the audio teardown, once for the
  // recognition teardown).
  let ended = false;
  rec.onend = () => {
    if (ended) return;
    ended = true;
    events.onEnd();
  };

  return {
    start() {
      try {
        rec.start();
      } catch (err) {
        // start() throws InvalidStateError if called while
        // already running. Surface that uniformly through the
        // error channel so the UI can't get stuck. Also fire
        // onEnd because we won't get a natural end event when
        // start never engaged the audio stream.
        const message = err instanceof Error ? err.message : "start failed";
        events.onError("unknown", message);
        if (!ended) {
          ended = true;
          events.onEnd();
        }
      }
    },
    stop() {
      try {
        // `abort()` (not `stop()`) for immediate termination.
        // iOS Safari's `stop()` waits for the recognizer to
        // decide an utterance is "done", which can hang
        // indefinitely if the user stays silent — leaving the
        // UI's Stop button visually pressed but with no exit
        // path. `abort()` tears down the audio stream right
        // away and fires `onend` next tick, which the UI uses
        // to transition out of the recording phase.
        rec.abort();
      } catch {
        // abort() can throw if the recognizer was never started.
        // Fire onEnd manually so the UI can still recover.
        if (!ended) {
          ended = true;
          events.onEnd();
        }
      }
    },
  };
}
