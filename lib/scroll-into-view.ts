/** Scroll an element to the top of its scroll container and *keep* it
 *  there while nearby layout reflows, then release.
 *
 *  Why this exists: when we deep-link to a section (e.g. Settings → Sync
 *  from the topbar chip), the sections rendered above it fetch their data
 *  on mount and grow afterwards — connected devices, passkeys, MFA. A
 *  one-shot `scrollIntoView` fires before they expand; by the time the
 *  data lands the target has been pushed down and the scroll is lost. The
 *  browser's scroll-anchoring doesn't save us either, because those
 *  sections swap their loading skeleton for fetched content, so there's no
 *  stable anchor node to hold position against.
 *
 *  Instead of guessing a delay long enough to outlast every fetch (a
 *  band-aid that still loses the race on a slow network), we observe the
 *  element's sibling wrapper and re-pin the target every time it reflows,
 *  until the layout goes quiet (no change for `quietMs` after content has
 *  loaded) or a hard cap (`maxMs`) elapses. Any manual scroll releases
 *  immediately so we never fight the user.
 *
 *  Returns a `stop()` cleanup; safe to call multiple times. */

const QUIET_MS = 300;
const MAX_MS = 3000;

export function scrollIntoViewUntilStable(
  el: HTMLElement,
  opts?: { quietMs?: number; maxMs?: number },
): () => void {
  const quietMs = opts?.quietMs ?? QUIET_MS;
  const maxMs = opts?.maxMs ?? MAX_MS;
  const pin = (behavior: ScrollBehavior) =>
    el.scrollIntoView({ behavior, block: "start" });

  // No ResizeObserver (SSR / very old engines): best-effort single scroll.
  if (typeof ResizeObserver === "undefined") {
    pin("smooth");
    return () => {};
  }

  let stopped = false;
  // ResizeObserver delivers the current size immediately on observe(). We
  // still re-pin on that first delivery, but we must NOT let it start the
  // "settled" countdown — otherwise a section that loads a beat later
  // (after a quiet gap) would stop us before it ever grows.
  let primed = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    clearTimeout(quietTimer);
    clearTimeout(maxTimer);
    window.removeEventListener("wheel", onUserScroll);
    window.removeEventListener("touchmove", onUserScroll);
    window.removeEventListener("keydown", onUserScroll);
  };

  // A real manual scroll means the user has taken over — let go at once.
  const onUserScroll = () => stop();

  const observer = new ResizeObserver(() => {
    if (stopped) return;
    // Always keep the target pinned to the top through reflow. Re-pinning
    // is a no-op once it's already there, so this is cheap and can't loop
    // (scrolling doesn't change the observed element's size).
    pin("auto");
    if (!primed) {
      primed = true;
      return;
    }
    // Genuine post-initial reflow (a section above finished loading): arm
    // / reset the quiet window so we release shortly after things settle.
    clearTimeout(quietTimer);
    quietTimer = setTimeout(stop, quietMs);
  });

  pin("auto");
  // Observe the sibling wrapper: its height changes whenever any sibling
  // above (or below) the target grows.
  observer.observe(el.parentElement ?? el);
  window.addEventListener("wheel", onUserScroll, { passive: true });
  window.addEventListener("touchmove", onUserScroll, { passive: true });
  window.addEventListener("keydown", onUserScroll);
  // Cap the total follow time so we never observe indefinitely (e.g. a
  // section that never resolves).
  const maxTimer = setTimeout(stop, maxMs);

  return stop;
}
