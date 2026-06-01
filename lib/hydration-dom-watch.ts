/** Captures the LITERAL server→client divergence behind a React
 *  hydration mismatch (#418 text / #423/#425 tree / attribute), which
 *  the minified prod build otherwise refuses to name.
 *
 *  Why a MutationObserver: a hydration mismatch is a RECOVERABLE error —
 *  React logs it via `console.error` and then patches the DOM in place
 *  (rewrites the offending text node, or removes the server nodes and
 *  inserts the client ones) so the visible tree matches the client. That
 *  patch IS the answer: the node's pre-mutation value is what the SERVER
 *  rendered, the post-mutation value is what the CLIENT rendered. We arm
 *  an observer BEFORE hydration so those mutations are recorded, then —
 *  at the exact instant the `console.error` interceptor fires — read them
 *  back.
 *
 *  The correlation is tight by construction: React calls `console.error`
 *  SYNCHRONOUSLY inside the same commit that performs the recovery
 *  mutation, before the microtask checkpoint that would flush the
 *  observer's callback. So `observer.takeRecords()` at error time returns
 *  exactly that commit's mutations — not the unrelated post-hydration
 *  churn (modals opening, async data resolving) that a time-buffered
 *  approach would drown in.
 *
 *  The ranking/shaping logic is kept pure (plain inputs, no DOM) so it's
 *  unit-testable; the thin DOM-touching observer wrapper sits below it
 *  and is installed from
 *  [install-error-capture.ts](./install-error-capture.ts). */

/** One captured divergence between the server-rendered DOM and what the
 *  client produced when it recovered from the mismatch. */
export type HydrationMutation = {
  /** "text"  — a text node's content changed (the #418 shape).
   *  "node"  — server nodes were replaced by client nodes (#423/#425).
   *  "attr"  — an element attribute's value diverged. */
  kind: "text" | "node" | "attr";
  /** Short CSS-ish path to the element whose content diverged, e.g.
   *  `main > section.account > dd`. For "attr", the attribute name is
   *  appended as `@name`. */
  path: string;
  /** What the SERVER rendered (the pre-recovery value). */
  server: string;
  /** What the CLIENT rendered (the post-recovery value). */
  client: string;
};

/** Cap on reported divergences — a single mismatch usually yields one or
 *  two meaningful records; more than this is noise. */
const MAX_REPORTED = 5;
/** Per-value text cap so a giant subtree's text content doesn't bloat the
 *  report. The mismatched value itself is almost always short. */
const MAX_TEXT = 200;

/** Context kept on each side of the divergence in a focused excerpt. */
const DIFF_CONTEXT = 40;

/** Collapse incidental whitespace (SSR text often differs only in
 *  whitespace) and trim, so the two sides compare on real content. */
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Cap a single value at MAX_TEXT, adding a trailing ellipsis. */
function cap(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
}

/** Trim the shared prefix/suffix of two differing strings and return a
 *  focused excerpt of each, centered on where they diverge. Without this,
 *  a recoverable mismatch that regenerates a whole subtree yields one big
 *  near-identical `server`/`client` blob, and a plain head-clip would cut
 *  off the actual difference (often deep in the blob). Inputs are assumed
 *  already normalized and known to differ. */
function focusDiff(a: string, b: string): { server: string; client: string } {
  const min = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < min && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const excerpt = (str: string): string => {
    const start = Math.max(0, prefix - DIFF_CONTEXT);
    const end = Math.min(str.length, str.length - suffix + DIFF_CONTEXT);
    const body = str.slice(start, end);
    return cap(`${start > 0 ? "…" : ""}${body}${end < str.length ? "…" : ""}`);
  };
  return { server: excerpt(a), client: excerpt(b) };
}

/** Pure: normalize, drop no-op / whitespace-only diffs, focus each
 *  divergence on the differing region, dedupe, and rank (text first, then
 *  attributes, then node swaps; larger diffs first), capping the count.
 *  DOM-free so it's unit-testable in isolation. */
export function rankHydrationMutations(
  muts: readonly HydrationMutation[],
): HydrationMutation[] {
  const order: Record<HydrationMutation["kind"], number> = {
    text: 0,
    attr: 1,
    node: 2,
  };
  const seen = new Set<string>();
  const meaningful = muts
    .map((m) => ({
      ...m,
      server: normalize(m.server),
      client: normalize(m.client),
    }))
    // Compare on the FULL normalized values — only real divergences
    // survive. (Comparing after a head-clip would mask diffs past the
    // clip and let identical-looking blobs through.)
    .filter((m) => m.server !== m.client)
    // Both-empty carries no signal (e.g. a comment-marker shuffle).
    .filter((m) => m.server !== "" || m.client !== "")
    .map((m) => ({ ...m, ...focusDiff(m.server, m.client) }))
    .filter((m) => {
      const key = `${m.kind}|${m.path}|${m.server}|${m.client}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  meaningful.sort((a, b) => {
    if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
    const sizeA = Math.max(a.server.length, a.client.length);
    const sizeB = Math.max(b.server.length, b.client.length);
    return sizeB - sizeA;
  });
  return meaningful.slice(0, MAX_REPORTED);
}

// ─── DOM observer (thin wrapper) ─────────────────────────────────────

/** Short, readable path from an element up to the root. Prefers `id`,
 *  then `data-testid`, then the first couple of class names — enough to
 *  locate the node in source without dumping a brittle full selector. */
function elementPath(el: Element | null): string {
  if (!el) return "(detached)";
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 6) {
    let seg = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${seg}#${node.id}`);
      break; // an id is specific enough to stop climbing.
    }
    const testid = node.getAttribute("data-testid");
    if (testid) {
      seg += `[data-testid="${testid}"]`;
    } else {
      const cls = (node.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      if (cls) seg += `.${cls}`;
    }
    parts.unshift(seg);
    node = node.parentElement;
    depth += 1;
  }
  return parts.join(" > ");
}

/** Convert one raw MutationRecord into zero or more captured divergences.
 *  Kept narrow: only the three mutation shapes React produces when it
 *  recovers a hydration mismatch. */
function recordToMutations(rec: MutationRecord): HydrationMutation[] {
  if (rec.type === "characterData") {
    const target = rec.target as CharacterData;
    return [
      {
        kind: "text",
        path: elementPath(target.parentElement),
        server: rec.oldValue ?? "",
        client: target.data ?? "",
      },
    ];
  }
  if (rec.type === "attributes" && rec.attributeName) {
    const target = rec.target as Element;
    return [
      {
        kind: "attr",
        path: `${elementPath(target)}@${rec.attributeName}`,
        server: rec.oldValue ?? "",
        client: target.getAttribute(rec.attributeName) ?? "",
      },
    ];
  }
  if (rec.type === "childList") {
    const server = Array.from(rec.removedNodes)
      .map((n) => n.textContent ?? "")
      .join("");
    const client = Array.from(rec.addedNodes)
      .map((n) => n.textContent ?? "")
      .join("");
    if (server === "" && client === "") return [];
    return [
      {
        kind: "node",
        path: elementPath(rec.target as Element),
        server,
        client,
      },
    ];
  }
  return [];
}

let observer: MutationObserver | null = null;
/** Rolling buffer of records already delivered to the callback. We can't
 *  know whether React logs the recoverable error just BEFORE it patches
 *  the DOM (patch still pending → `takeRecords()`) or just AFTER (patch
 *  already drained to the callback → here). Keeping a short lookback of
 *  recently-delivered records covers the "after" ordering. Trimmed to a
 *  bound so it can't grow with normal app churn. */
let recent: MutationRecord[] = [];
// A recoverable mismatch can regenerate a whole subtree, so allow a
// generous lookback; ranking + dedupe collapse the volume back down.
const RECENT_MAX = 500;

/** Arm the observer before React hydrates. Idempotent + SSR-safe. The
 *  observer watches the whole document for the three recovery shapes; the
 *  volume is irrelevant because we only ever read a small window around
 *  the one instant a hydration error fires. A safety timeout disconnects
 *  even if no error ever fires, so it never outlives the hydration
 *  window. */
export function installHydrationWatch(): void {
  if (
    observer ||
    typeof window === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return;
  }
  observer = new MutationObserver((records) => {
    recent.push(...records);
    if (recent.length > RECENT_MAX) recent = recent.slice(-RECENT_MAX);
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    characterDataOldValue: true,
    attributes: true,
    attributeOldValue: true,
  });
  // Hydration is an early, one-shot event; once the window is well past,
  // stop observing so we don't carry the overhead for the session.
  window.setTimeout(disconnectHydrationWatch, 20_000);
}

/** Stop observing and release the buffer. Safe to call repeatedly. */
export function disconnectHydrationWatch(): void {
  observer?.disconnect();
  observer = null;
  recent = [];
}

/** Read the divergences React patched around a hydration error, ranked,
 *  and hand them to `done`. Call this the moment the error is detected.
 *
 *  It collects across three points so the recovery mutation is caught
 *  regardless of React's log-vs-patch ordering: the lookback buffer
 *  (`recent`, patch already delivered), `takeRecords()` now (patch still
 *  pending this tick), and one more `takeRecords()` a frame later (patch
 *  deferred to a follow-up commit — the "flicker seconds later" shape).
 *  Async by one frame; the caller's dedupe guard already prevents a
 *  double report. */
export function collectHydrationMutations(
  done: (mutations: HydrationMutation[]) => void,
): void {
  if (!observer) {
    done([]);
    return;
  }
  const lookback = recent.slice();
  const pendingNow = observer.takeRecords();
  window.requestAnimationFrame(() => {
    const tail = observer ? observer.takeRecords() : [];
    const raw = [...lookback, ...pendingNow, ...tail];
    done(rankHydrationMutations(raw.flatMap(recordToMutations)));
  });
}
