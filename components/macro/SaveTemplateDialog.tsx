"use client";

import type { FoodItem } from "@/components/macro/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMealTemplate } from "@/lib/db";
import { bumpPending } from "@/lib/sync-status";
import { useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The meal foods to capture. Empty array disables Save. */
  foods: FoodItem[];
  /** Default name to seed the input — typically the source meal's name. */
  defaultName: string;
  onSaved: () => void;
};

/** Modal for saving the currently-selected meal as a reusable template.
 * Captures portions as-they-are; the user can edit after applying. */
export function SaveTemplateDialog({
  open,
  onOpenChange,
  foods,
  defaultName,
  onSaved,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {/* Remount the inner form whenever the source meal changes so
            internal state (name, error) resets without a setState-in-effect. */}
        <SaveTemplateForm
          key={`${open}-${defaultName}`}
          foods={foods}
          defaultName={defaultName}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function SaveTemplateForm({
  foods,
  defaultName,
  onClose,
  onSaved,
}: {
  foods: FoodItem[];
  defaultName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = foods.length > 0 && name.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await saveMealTemplate({ name: name.trim(), foods });
      bumpPending();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save as template</DialogTitle>
        <DialogDescription>
          Capture this meal&apos;s {foods.length} food
          {foods.length === 1 ? "" : "s"} (portions and all) so you can re-apply
          it to any meal slot later.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 py-2">
        <Label htmlFor="template-name">Name</Label>
        <Input
          id="template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Greek yogurt bowl"
          autoFocus
        />
        {foods.length === 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This meal has no foods yet — add some before saving as a template.
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="text-sm text-red-600"
        >
          {error}
        </p>
      )}

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          onClick={save}
          disabled={!canSave}
        >
          {saving ? "Saving…" : "Save template"}
        </Button>
      </DialogFooter>
    </>
  );
}
