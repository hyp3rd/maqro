import type { CapturePollResponse } from "./types";

/** 2 s feels responsive without flooding the server during the typical
 *  5–30 s phone-capture interaction. */
const DEFAULT_INTERVAL_MS = 2_000;
/** Exponential backoff cap on network blips. */
const MAX_INTERVAL_MS = 8_000;
/** Matches the capture row's 5-minute expiry so we never poll past a
 *  guaranteed-stale session. */
const TOTAL_TIMEOUT_MS = 5 * 60_000;

export type PollResult =
  | { kind: "ready"; payload: CapturePollResponse }
  | { kind: "timeout" }
  | { kind: "aborted" }
  | { kind: "expired" };

type PollOptions = {
  /** Override for tests. */
  intervalMs?: number;
  totalTimeoutMs?: number;
  /** Test hook — defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Test hook — defaults to `fetch`. */
  fetcher?: typeof fetch;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll /api/capture/[id] until it returns `ready: true`, the signal
 *  fires, the session expires (404), or the total timeout elapses.
 *  Network errors trigger exponential backoff (2 → 4 → 8 s, capped);
 *  4xx responses other than 404 are treated as retryable transients,
 *  while 404 is fatal (session is gone, never coming back). */
export async function pollCapture(
  id: string,
  signal: AbortSignal,
  options: PollOptions = {},
): Promise<PollResult> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const totalMs = options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const f = options.fetcher ?? fetch;

  const deadline = Date.now() + totalMs;
  let nextInterval = intervalMs;

  while (Date.now() < deadline) {
    if (signal.aborted) return { kind: "aborted" };

    try {
      const res = await f(`/api/capture/${encodeURIComponent(id)}`, {
        signal,
        cache: "no-store",
      });
      if (res.status === 404) {
        return { kind: "expired" };
      }
      if (res.ok) {
        const body = (await res.json()) as CapturePollResponse;
        if (body.ready) return { kind: "ready", payload: body };
        nextInterval = intervalMs;
      }
      // Non-ok, non-404 → fall through to backoff.
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { kind: "aborted" };
      }
      // Network blip — exponential backoff, capped.
    }

    await sleep(nextInterval);
    nextInterval = Math.min(nextInterval * 2, MAX_INTERVAL_MS);
  }
  return { kind: "timeout" };
}
