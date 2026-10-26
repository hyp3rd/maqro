"use client";

import { parseClock } from "@/lib/today/timeline";
import { cn } from "@/lib/utils";
import { useId, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** What the dialog asks: a time of the meal's day, for when it was eaten
 *  ("Ate it earlier…", no later than now) or when it is planned for ("Plan
 *  for…"). */
export type MealTimeRequest = {
  title: string;
  description: string;
  /** The `HH:MM` the field starts at. */
  initial: string;
  /** The latest `HH:MM` allowed, for a time that has to be past. */
  latest?: string;
  confirmLabel: string;
  onConfirm: (time: string) => void;
  /** A second answer beside the time, e.g. back to the usual time. */
  reset?: { label: string; onReset: () => void };
};

/** A small dialog picking one `HH:MM`. `request` stays set while it closes,
 *  so its words don't blank out during the close animation. */
export function MealTimeDialog({
  open,
  request,
  onClose,
}: {
  open: boolean;
  request: MealTimeRequest | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open && request !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        {request && (
          // A fresh form per request, so the field starts at its time.
          <MealTimeForm
            key={`${request.title}-${request.initial}`}
            request={request}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MealTimeForm({
  request,
  onClose,
}: {
  request: MealTimeRequest;
  onClose: () => void;
}) {
  const id = useId();
  const [time, setTime] = useState(request.initial);
  const minute = parseClock(time);
  const latest = parseClock(request.latest);
  const tooLate = minute !== null && latest !== null && minute > latest;
  const canConfirm = minute !== null && !tooLate;

  const confirm = () => {
    if (!canConfirm) return;
    request.onConfirm(time);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        <DialogDescription>{request.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-2">
        <Label htmlFor={`${id}-time`}>Time</Label>
        <Input
          id={`${id}-time`}
          type="time"
          value={time}
          max={request.latest}
          onChange={(e) => setTime(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirm();
          }}
          aria-invalid={tooLate}
          aria-describedby={tooLate ? `${id}-hint` : undefined}
          className={cn("font-mono tabular-nums", tooLate && "border-warning")}
        />
        {tooLate && (
          <p
            id={`${id}-hint`}
            className="text-label text-foreground"
          >
            That&apos;s later than now. Pick a time that has passed.
          </p>
        )}
      </div>

      <DialogFooter className="gap-2">
        {request.reset && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              request.reset?.onReset();
              onClose();
            }}
            className="sm:mr-auto"
          >
            {request.reset.label}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={confirm}
          disabled={!canConfirm}
        >
          {request.confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
