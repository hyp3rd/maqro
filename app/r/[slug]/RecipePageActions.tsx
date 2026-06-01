"use client";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { useState } from "react";
import { Check, Loader2, Plus, Printer } from "lucide-react";
import Link from "next/link";

/** Top-right actions for a shared recipe page. Two affordances:
 *
 *  1. **Print** — `window.print()`. The page is already styled for
 *     print (header chrome hidden, borders darkened). Browsers offer
 *     "Save as PDF" in the print dialog, which is the PDF export.
 *  2. **Import** — for signed-in visitors, posts to
 *     `/api/recipes/import/[slug]` and shows a success state. For
 *     guests, links to `/login?returnTo=/r/<slug>` so they sign in
 *     and come back to click Import.
 *
 *  Auth state is checked on the client because the page itself is
 *  cacheable / shareable and we don't want it gated by auth — the
 *  read works for anyone via the public RLS policy. */
export function RecipePageActions({ slug }: { slug: string }) {
  const { user, isLoaded } = useUser();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!user || importing) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/recipes/import/${encodeURIComponent(slug)}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Import failed (HTTP ${res.status})`);
      }
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => window.print()}
        className="h-9 gap-1.5"
      >
        <Printer className="h-3.5 w-3.5" />
        Print / PDF
      </Button>

      {!isLoaded ? (
        // Match the size of the eventual button so the layout doesn't shift.
        <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
      ) : user ? (
        imported ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="h-9 gap-1.5"
          >
            <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            Imported
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleImport}
            disabled={importing}
            className="h-9 gap-1.5"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {importing ? "Importing…" : "Import to my recipes"}
          </Button>
        )
      ) : (
        <Button
          type="button"
          size="sm"
          asChild
          className="h-9 gap-1.5"
        >
          <Link href={`/login?next=${encodeURIComponent(`/r/${slug}`)}`}>
            <Plus className="h-3.5 w-3.5" />
            Sign in to import
          </Link>
        </Button>
      )}

      {error && (
        <p
          role="alert"
          className="text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}
