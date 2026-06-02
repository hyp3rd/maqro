"use client";

import type { DisplayItem } from "@/lib/shopping-list";
import { useState } from "react";
import {
  MessageSquare,
  Minus,
  PackagePlus,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SheetAction } from "./SheetAction";

type Props = {
  /** The item whose action sheet is open. `null` = closed. */
  item: DisplayItem | null;
  /** Current saved note for the item, if any. */
  note: string | undefined;
  onOpenChange: (open: boolean) => void;
  /** Persist a quantity edit. `grams`/`count` are raw input strings —
   *  the parent parses + validates (mirrors the old inline editor). */
  onSaveQty: (item: DisplayItem, grams: string, count: string) => void;
  onSendToPantry: (item: DisplayItem) => void;
  onSaveNote: (item: DisplayItem, note: string) => void;
  /** Remove from the list — the parent shows an undo toast. */
  onRemove: (item: DisplayItem) => void;
};

/** Tap-to-act bottom-sheet for a shopping-list row — the mobile-first
 *  replacement for the old per-row icon cluster + inline number inputs.
 *  Matches the meal-log / pantry sheets: a clean action list that steps
 *  into a finger-sized quantity stepper or a note editor. The body lives
 *  in `ItemFlow`, rendered inside DialogContent so it remounts per open
 *  (fresh step state, no reset effect). */
export function ShoppingItemSheet({
  item,
  note,
  onOpenChange,
  onSaveQty,
  onSendToPantry,
  onSaveNote,
  onRemove,
}: Props) {
  return (
    <Dialog
      open={item !== null}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="gap-3">
        {item && (
          <ItemFlow
            key={item.name}
            item={item}
            note={note}
            onClose={() => onOpenChange(false)}
            onSaveQty={onSaveQty}
            onSendToPantry={onSendToPantry}
            onSaveNote={onSaveNote}
            onRemove={onRemove}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemFlow({
  item,
  note,
  onClose,
  onSaveQty,
  onSendToPantry,
  onSaveNote,
  onRemove,
}: {
  item: DisplayItem;
  note: string | undefined;
  onClose: () => void;
  onSaveQty: (item: DisplayItem, grams: string, count: string) => void;
  onSendToPantry: (item: DisplayItem) => void;
  onSaveNote: (item: DisplayItem, note: string) => void;
  onRemove: (item: DisplayItem) => void;
}) {
  const [step, setStep] = useState<"actions" | "qty" | "note">("actions");
  const [grams, setGrams] = useState(String(item.totalGrams));
  const [count, setCount] = useState(
    item.isExtra ? "" : String(item.appearances),
  );
  const [noteDraft, setNoteDraft] = useState(note ?? "");

  const unit = item.isExtra ? (item.extraUnit ?? "g") : "g";

  function bumpGrams(delta: number) {
    const n = Number.parseFloat(grams.replace(",", ".")) || 0;
    setGrams(String(Math.max(0, Math.round((n + delta) * 1000) / 1000)));
  }
  function bumpCount(delta: number) {
    const n = Number.parseInt(count, 10) || 0;
    setCount(String(Math.max(0, n + delta)));
  }

  const summary = item.isExtra
    ? `${item.totalGrams} ${unit} · restock`
    : `${item.totalGrams} g · ${item.appearances}×`;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-6 text-left">
          {item.name}
        </DialogTitle>
        <DialogDescription className="text-left font-mono text-xs tabular-nums">
          {step === "qty"
            ? "Adjust the quantity for your shopping run."
            : step === "note"
              ? "Add a note — pack size, brand, a reminder."
              : summary}
        </DialogDescription>
      </DialogHeader>

      {step === "actions" && (
        <div className="space-y-0.5 pt-1">
          <SheetAction
            icon={SlidersHorizontal}
            label="Edit quantity"
            hasNext
            onClick={() => setStep("qty")}
          />
          <SheetAction
            icon={PackagePlus}
            label="Send to pantry"
            onClick={() => {
              onSendToPantry(item);
              onClose();
            }}
          />
          <SheetAction
            icon={MessageSquare}
            label={note ? "Edit note" : "Add note"}
            hasNext
            onClick={() => setStep("note")}
          />
          <SheetAction
            icon={Trash2}
            label="Remove from list"
            destructive
            onClick={() => {
              onRemove(item);
              onClose();
            }}
          />
        </div>
      )}

      {step === "qty" && (
        <div className="space-y-4 pt-1">
          <Stepper
            label={`Quantity (${unit})`}
            value={grams}
            onChange={setGrams}
            onBump={bumpGrams}
            step={10}
          />
          {!item.isExtra && (
            <Stepper
              label="Times logged (×)"
              value={count}
              onChange={setCount}
              onBump={bumpCount}
              step={1}
              integer
            />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-12 flex-1"
              onClick={() => setStep("actions")}
            >
              Back
            </Button>
            <Button
              type="button"
              className="h-12 flex-1"
              onClick={() => {
                onSaveQty(item, grams, count);
                onClose();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {step === "note" && (
        <div className="space-y-3 pt-1">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="e.g. 1 kg pack, ask staff if missing"
            rows={3}
            autoFocus
            className="w-full resize-y rounded-md border border-border/60 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-12 flex-1"
              onClick={() => setStep("actions")}
            >
              Back
            </Button>
            <Button
              type="button"
              className="h-12 flex-1"
              onClick={() => {
                onSaveNote(item, noteDraft);
                onClose();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Stepper({
  label,
  value,
  onChange,
  onBump,
  step,
  integer,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBump: (delta: number) => void;
  step: number;
  integer?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-12 w-12 shrink-0"
          onClick={() => onBump(-step)}
          aria-label={`Decrease by ${step}`}
        >
          <Minus className="h-5 w-5" />
        </Button>
        <Input
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          step={integer ? "1" : "0.1"}
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 flex-1 text-center font-mono text-lg tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-12 w-12 shrink-0"
          onClick={() => onBump(step)}
          aria-label={`Increase by ${step}`}
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
