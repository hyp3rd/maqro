"use client";

/** Pub/sub for service-worker update events. `ServiceWorkerProvider`
 *  publishes here when it detects an installed-and-waiting SW;
 *  `UpdateBanner` subscribes so it can surface the prompt without
 *  the two components needing direct knowledge of each other.
 *
 *  Kept separate from the version-poll path because the two have
 *  different correctness characteristics: the SW signal fires
 *  immediately on update install, while the version poll has up to
 *  a 10-minute lag. When both are available, the SW signal wins;
 *  the poll stays as a fallback for browsers without SW support. */

type UpdateHandler = (waiting: ServiceWorker) => void;

const subscribers = new Set<UpdateHandler>();

export function notifyServiceWorkerUpdate(waiting: ServiceWorker): void {
  for (const s of subscribers) s(waiting);
}

export function subscribeServiceWorkerUpdate(cb: UpdateHandler): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
