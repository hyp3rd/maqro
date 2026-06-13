"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Prev / page / Next pagination strip for admin tables.
 *
 *  Previously each page open-coded the same three-button layout.
 *  Centralizing it here gives:
 *
 *    - consistent button height + spacing across pages
 *    - icon glyphs (left / right chevrons) instead of word
 *      buttons; faster scan, less localization surface
 *    - explicit page-of-N label rather than just "Page 3"
 *    - hidden entirely when there's only one page (the parent
 *      doesn't need its own `totalPages > 1` guard)
 *
 *  Cursor-paginated tables (invoices) keep their own Load-more
 *  affordance — this primitive is for page-number style only. */

export function AdminPagination({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (next: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const atFirst = page <= 1;
  const atLast = page >= totalPages;
  return (
    <div
      className={["flex items-center justify-end gap-2 text-xs", className]
        .filter(Boolean)
        .join(" ")}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0 coarse:h-11 coarse:w-11"
        aria-label="Previous page"
        disabled={atFirst}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="font-mono tabular-nums text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0 coarse:h-11 coarse:w-11"
        aria-label="Next page"
        disabled={atLast}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
