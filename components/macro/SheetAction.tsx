"use client";

import { cn } from "@/lib/utils";
import type { ComponentType } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "../ui/button";

/** One full-width, finger-sized action row inside a mobile action sheet.
 *  Shared by the tap-to-act bottom-sheets (meal log, pantry, …) so every
 *  list surface presents its row actions identically. */
export function SheetAction({
  icon: Icon,
  label,
  onClick,
  destructive,
  hasNext,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  hasNext?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-3.5 text-left text-sm font-medium transition-colors active:bg-muted",
        destructive ? "text-destructive" : "text-foreground",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1">{label}</span>
      {hasNext && (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
      )}
    </button>
  );
}

/** Destructive confirm step shown inside the same action sheet (so every
 *  delete is a bottom-sheet confirmation, never a native `confirm()` or a
 *  separate modal). Cancel returns to the action list; the confirm button
 *  is full-width and finger-sized. */
export function SheetConfirm({
  title,
  description,
  confirmLabel = "Remove",
  onCancel,
  onConfirm,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4 pt-1">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-12 flex-1"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-12 flex-1"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
