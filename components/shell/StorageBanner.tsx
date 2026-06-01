"use client";

import { Button } from "@/components/ui/button";
import { ackStorageError, useStorageStatus } from "@/lib/storage-status";
import { AlertTriangle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

/** Slim warning banner shown when persistence is unavailable (commonly
 * private/incognito mode, or quota exhaustion). The hook reads from a
 * shared store so every component sees the same state. Auto-disappears
 * once a write succeeds again. */
export function StorageBanner() {
  const { ok, acknowledged } = useStorageStatus();
  const visible = !ok && !acknowledged;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="overflow-hidden border-b border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          role="status"
        >
          <div className="mx-auto flex max-w-6xl items-start gap-3 px-6 py-2.5 text-xs">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden
            />
            <p className="flex-1 leading-snug">
              <span className="font-medium">Saving is unavailable.</span> Your
              changes are kept in memory but won&apos;t persist after a reload.
              This usually means private/incognito mode or that storage is
              blocked.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-amber-900 hover:bg-amber-500/20 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-200"
              onClick={ackStorageError}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
