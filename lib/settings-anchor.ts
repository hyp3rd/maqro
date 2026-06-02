/** One-shot hand-off for "open Settings and scroll to a section".
 *
 *  The app is a single-page shell: switching to Settings swaps the view
 *  via `onSelectView("settings")`, and the old view animates out before
 *  the new one mounts (AnimatePresence `mode="wait"`). That means a
 *  caller can't scroll to a section itself — the target isn't in the DOM
 *  yet when the click fires. Instead the caller *requests* an anchor here;
 *  the matching section consumes it on mount and scrolls into view.
 *
 *  A plain module variable (not state/context) is deliberate: it survives
 *  the view swap, carries no re-render cost, and is read exactly once. */

let pending: string | null = null;

/** Mark a Settings section to scroll to once Settings next mounts. */
export function requestSettingsScroll(anchor: string): void {
  pending = anchor;
}

/** Read and clear the pending anchor. Returns null when nothing is
 *  queued, so a normal Settings open doesn't auto-scroll. */
export function consumeSettingsScroll(): string | null {
  const anchor = pending;
  pending = null;
  return anchor;
}
