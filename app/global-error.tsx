"use client";

import { reportClientError } from "@/lib/error-reporter";
import { useEffect } from "react";

/** Outer-most Next.js error boundary. Catches errors that even the
 *  root [error.tsx](./error.tsx) can't — namely errors thrown by
 *  [layout.tsx](./layout.tsx) itself or its providers.
 *
 *  Critical constraint: this component MUST render its own
 *  `<html>` and `<body>` because the layout failed. No fonts, no
 *  toaster, no theme provider — those are exactly what failed.
 *  Inline styles keep us independent of `globals.css` too, in
 *  case its load was the original failure. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, {
      route: "global",
      context: { digest: error.digest, scope: "global-error-boundary" },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          color: "#0a0a0c",
          background: "#fff",
        }}
      >
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem 1.5rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Maqro hit a fatal error
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#6b7280",
              maxWidth: "28rem",
              margin: "0.75rem 0 1.5rem",
              lineHeight: 1.55,
            }}
          >
            The app couldn&apos;t recover. Your data is safe on this device. Try
            refreshing — if it keeps happening, clear site data from browser
            settings and reload.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              appearance: "none",
              background: "#0a0a0c",
              color: "#fff",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
