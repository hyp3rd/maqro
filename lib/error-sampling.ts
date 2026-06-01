/** Protective sampling for the client error/warning log.
 *
 *  A single client can emit the SAME report thousands of times in one
 *  session — a render loop, or a hydration mismatch a user keeps reloading
 *  into (e.g. an extension-caused #418). Without a cap each one is a row in
 *  `error_log`, drowning the signal and the quota. This throttles repeats
 *  of an identical report: log the first few in full, then keep only a thin
 *  sample.
 *
 *  Counts persist in `sessionStorage`, so the throttle survives reloads
 *  within a tab (where the same mismatch recurs) but resets for a fresh
 *  session — and never correlates across users. The decision logic is pure
 *  + DOM-free for unit testing; the storage wrapper is the thin shell. */

/** Occurrences logged in full before sampling kicks in. */
export const KEEP_FIRST = 3;
/** After the first `KEEP_FIRST`, drop this many, then keep one — repeat. */
export const DROP_WINDOW = 100;

/** Pure: should the Nth occurrence (1-based) of an identical report be
 *  logged? Logs 1…KEEP_FIRST, then one every `DROP_WINDOW + 1` — i.e. with
 *  3/100 it logs occurrences 1, 2, 3, 104, 205, 306, … so a sustained
 *  flood lands ≈1% of its volume in the database. */
export function shouldLogOccurrence(count: number): boolean {
  if (count <= KEEP_FIRST) return true;
  return (count - KEEP_FIRST) % (DROP_WINDOW + 1) === 0;
}

const STORAGE_KEY = "maqro:error-sample-counts";
/** Cap on distinct signatures tracked at once, so a flood of UNIQUE errors
 *  can't grow storage without bound. On overflow we reset the whole map
 *  (the next occurrences simply re-log from 1 — fail open, never silent). */
const MAX_TRACKED = 200;

/** Small, stable string hash (djb2) so we key on a short token instead of
 *  storing full error messages in `sessionStorage`. */
function hashSignature(signature: string): string {
  let hash = 5381;
  for (let i = 0; i < signature.length; i += 1) {
    hash = (hash * 33 + signature.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function readCounts(): Record<string, number> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

/** Record one occurrence of `signature` and return whether it should be
 *  logged. SSR-safe (no window → always log; nothing is reported there
 *  anyway). Fails OPEN on any storage error so we never silently drop. */
export function recordAndShouldLog(signature: string): boolean {
  if (typeof window === "undefined") return true;
  let counts = readCounts();
  if (Object.keys(counts).length > MAX_TRACKED) counts = {};
  const key = hashSignature(signature);
  const next = (counts[key] ?? 0) + 1;
  counts[key] = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch {
    return true;
  }
  return shouldLogOccurrence(next);
}
