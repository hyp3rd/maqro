"use client";

import { reportClientError } from "@/lib/error-reporter";
import { useEffect } from "react";

/** Next.js error boundary for the root segment. Catches render-
 *  time errors in any client component below the root layout
 *  AND any error thrown by a server component during request
 *  rendering. The component-tree above (the layout itself,
 *  fonts, providers) is covered by [global-error.tsx](./global-error.tsx).
 *
 *  We report once on mount and then render a friendly fallback
 *  with a Retry button. The button calls Next's `reset()` to
 *  reattempt the failed render — useful for transient failures
 *  (network blip, race condition) without forcing a full page
 *  reload. */
export default function GlobalSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, {
      route: typeof window !== "undefined" ? window.location.pathname : "",
      context: { digest: error.digest, scope: "app-error-boundary" },
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <h1 className="text-lg font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Maqro hit an unexpected error rendering this page. Your data is safe on
        this device. Try again — if it persists, refresh the page or check back
        in a moment.
      </p>
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/40"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
