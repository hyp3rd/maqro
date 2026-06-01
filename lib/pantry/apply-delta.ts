import { clientFetch } from "@/lib/auth/client-fetch";
import {
  addPantryNotification,
  listPantryItems,
  listPantryNotifications,
  upsertPantryItem,
} from "@/lib/db";
import { reportStorageError } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { crossedLow, type PantryConsumption, roundQuantity } from "./consume";

/** Module-scoped Promise chain that serializes every pantry-item write
 *  in this browser tab. Two writes targeting the same item from
 *  different call sites (a meal-add and a batch-apply running in
 *  parallel, say) take turns instead of racing on read-then-write —
 *  the consumer order matches call order. The chain is rooted at a
 *  resolved Promise so the first call has nothing to await. */
let pantryWriteChain: Promise<void> = Promise.resolve();

/** Apply a signed delta to a single pantry item. `delta > 0` draws
 *  (matched-and-eaten); `delta < 0` restores (food removed / edited /
 *  swapped). Silent no-op when the item has been deleted between the
 *  caller's read and this write — a delta against a dead id can't
 *  damage anything, and surfacing it as an error would be noise.
 *
 *  Fire-and-forget: returns void rather than the chained Promise so
 *  call sites stay synchronous (the React handlers don't have to be
 *  async just to apply a draw). Errors land in `reportStorageError`. */
export function applyPantryDelta(itemId: string, delta: number): void {
  if (delta === 0) return;
  pantryWriteChain = pantryWriteChain
    .then(async () => {
      const items = await listPantryItems();
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      const newQuantity = roundQuantity(Math.max(0, item.quantity - delta));
      if (newQuantity === item.quantity) return;
      await upsertPantryItem({ ...item, quantity: newQuantity });
      bumpPending();
      if (
        delta > 0 &&
        crossedLow(
          item.unit,
          item.quantity,
          newQuantity,
          delta,
          item.lowThreshold,
        )
      ) {
        await notifyLowStock([{ item, newQuantity, nowLow: true }]);
      }
    })
    .catch((err) => {
      reportStorageError(err);
    });
}

/** Awaitable variant for callers that need to know the write landed
 *  before continuing — e.g., the multi-day batch-apply path, which
 *  toasts "Used N pantry items" after every per-item write resolves.
 *  Same chain as `applyPantryDelta`, so ordering with sync callers is
 *  preserved. */
export async function applyPantryDeltaAwaitable(
  itemId: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  const chained = pantryWriteChain.then(async () => {
    const items = await listPantryItems();
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const newQuantity = roundQuantity(Math.max(0, item.quantity - delta));
    if (newQuantity === item.quantity) return;
    await upsertPantryItem({ ...item, quantity: newQuantity });
    bumpPending();
    if (
      delta > 0 &&
      crossedLow(
        item.unit,
        item.quantity,
        newQuantity,
        delta,
        item.lowThreshold,
      )
    ) {
      await notifyLowStock([{ item, newQuantity, nowLow: true }]);
    }
  });
  pantryWriteChain = chained.catch(() => {});
  await chained;
}

/** Emit "low stock" notifications for the items that just crossed the
 *  threshold: an in-app notification per item (deduped against unread
 *  ones for the same item, so re-applying a recipe doesn't pile up
 *  duplicates) plus a best-effort Web Push. Failure-tolerant — the
 *  pantry decrement already succeeded, so a notification hiccup never
 *  blocks it. */
export async function notifyLowStock(
  newlyLow: PantryConsumption[],
): Promise<void> {
  let existing: Awaited<ReturnType<typeof listPantryNotifications>>;
  try {
    existing = await listPantryNotifications();
  } catch {
    existing = [];
  }
  const alreadyAlerted = new Set(
    existing.filter((n) => !n.read).map((n) => n.itemId),
  );

  let created = false;
  for (const { item, newQuantity } of newlyLow) {
    if (alreadyAlerted.has(item.id)) continue;
    try {
      await addPantryNotification({
        type: "low-stock",
        itemId: item.id,
        itemName: item.name,
        quantity: newQuantity,
        unit: item.unit,
        read: false,
      });
      created = true;
    } catch (err) {
      reportStorageError(err);
      continue;
    }
    void clientFetch("/api/push/pantry-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemName: item.name,
        quantity: newQuantity,
        unit: item.unit,
      }),
    }).catch(() => {});
  }
  if (created) bumpPending();
}
