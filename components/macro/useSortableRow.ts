"use client";

import type { CSSProperties, RefCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** Per-row sortable plumbing shared across the My Foods / Recipes /
 *  Templates lists. Each list renders differently (table rows, list
 *  items, mobile cards), so a fully-prefab `SortableRow` component
 *  would either duplicate every variant or force a wrapper that
 *  breaks semantic HTML. This hook returns the bits each consumer
 *  needs to attach to whatever element it already renders:
 *
 *  - `setNodeRef` — wire to the row's `ref`
 *  - `style` — apply the drag transform / opacity
 *  - `handleProps` — spread onto the grip handle button (the listener
 *    + ARIA attributes)
 *  - `isDragging` — UI hint for opacity / shadow
 *
 *  When `disabled` is true (sort mode isn't "custom") the hook still
 *  returns valid props but `handleProps` becomes inert — clicks on the
 *  grip do nothing and ARIA reports the row as non-draggable. */
export function useSortableRow(
  id: string,
  disabled = false,
): {
  setNodeRef: RefCallback<HTMLElement>;
  style: CSSProperties;
  handleProps: {
    ref: (node: HTMLElement | null) => void;
    "aria-roledescription"?: string;
    "aria-describedby"?: string;
  } & Record<string, unknown>;
  isDragging: boolean;
} {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return {
    setNodeRef,
    style,
    handleProps: {
      ref: setActivatorNodeRef,
      ...(disabled ? {} : (listeners ?? {})),
      ...attributes,
    },
    isDragging,
  };
}
