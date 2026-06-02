"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CloudUpload, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of unsaved local changes. */
  count: number;
  /** True while a save is in flight (after the user taps Save now). */
  saving: boolean;
  onSave: () => void;
};

/** Gentle "you have unsaved changes" nudge for **local-first** mode —
 *  fires after a quiet spell so the user doesn't lose edits they
 *  forgot to sync. Slick rather than nagging: a soft-pulsing cloud,
 *  a clear "Save now", and a low-friction "Later". */
export function SaveReminderDialog({
  open,
  onOpenChange,
  count,
  saving,
  onSave,
}: Props) {
  const noun = count === 1 ? "change" : "changes";
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="gap-4">
        <div className="flex flex-col items-center pt-1 text-center">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18 }}
            className="relative mb-3 flex h-14 w-14 items-center justify-center"
          >
            {/* Soft pulsing halo. */}
            <AnimatePresence>
              <motion.span
                key="halo"
                className="absolute inset-0 rounded-full bg-amber-500/15"
                animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
                transition={{
                  duration: 2.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                aria-hidden
              />
            </AnimatePresence>
            <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <CloudUpload className="h-6 w-6" />
            </span>
          </motion.div>
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-center">
              {count} unsaved {noun}
            </DialogTitle>
            <DialogDescription className="text-center">
              Local-first keeps your edits on this device until you save. Save
              now to sync them to your account and other devices.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            type="button"
            className="h-11 flex-1 gap-1.5"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CloudUpload className="h-4 w-4" />
            )}
            {saving ? "Saving…" : "Save now"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 flex-1"
            onClick={() => onOpenChange(false)}
          >
            Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
