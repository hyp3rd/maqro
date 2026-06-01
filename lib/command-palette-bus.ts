"use client";

/** Tiny pub/sub so anything in the tree can ask the global
 *  [CommandPalette](../components/shell/CommandPalette.tsx) to
 *  open without having to thread a callback through every
 *  ancestor.
 *
 *  Current consumers:
 *    - The Cmd-K / Ctrl-K keyboard handler inside CommandPalette
 *      itself (subscribes implicitly via its keydown listener).
 *    - The [TopbarSearchButton](../components/shell/Topbar.tsx)
 *      — a visible button that emits an open request so the
 *      feature is discoverable to mouse users.
 *
 *  Pattern mirrors [lib/sw-update-bus.ts](./sw-update-bus.ts)
 *  and [lib/profile-bus.ts](./profile-bus.ts). */

const subscribers = new Set<() => void>();

export function openCommandPalette(): void {
  for (const s of subscribers) s();
}

export function subscribeOpenCommandPalette(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
