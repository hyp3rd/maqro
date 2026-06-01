"use client";

import { Button } from "@/components/ui/button";
import type { ChangelogEntry } from "@/lib/changelog";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { EntryItem } from "./EntryItem";

/** Pagination footer for the changelog. Reveals further batches of
 *  older entries on click — keeps the initial render light (first
 *  N entries above the fold, the rest unrendered) while still
 *  giving users a path to the full history without a separate
 *  archive route.
 *
 *  Why not "load on scroll": users tend to land on the changelog
 *  expecting the latest, scan a few entries, and leave. Auto-
 *  loading older entries during that scan wastes work and
 *  surprises screen-reader users with an ever-growing list. An
 *  explicit button is one tap they can opt into.
 *
 *  Pagination batch size matches what fits roughly one viewport
 *  of an average entry (5 currently). Tune if you change the body
 *  rendering density. */
const BATCH_SIZE = 5;

export function ChangelogTail({ entries }: { entries: ChangelogEntry[] }) {
  const [visibleCount, setVisibleCount] = useState(0);
  if (entries.length === 0) return null;

  const visible = entries.slice(0, visibleCount);
  const remaining = entries.length - visibleCount;

  return (
    <>
      {visible.map((entry) => (
        <EntryItem
          key={entry.id}
          entry={entry}
        />
      ))}
      {remaining > 0 && (
        // Sits as a list item so the surrounding `<ol>` still reads
        // as a single list — assistive tech announces "remaining N
        // hidden, button to reveal" instead of "list ended, then
        // standalone button" which reads as a navigation jump.
        <li className="list-none pl-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              setVisibleCount((n) => Math.min(n + BATCH_SIZE, entries.length))
            }
          >
            <ChevronDown className="h-3.5 w-3.5" />
            Show {Math.min(BATCH_SIZE, remaining)} older{" "}
            {remaining === 1 ? "entry" : "entries"}
          </Button>
        </li>
      )}
    </>
  );
}
