"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

/** Client-side filter for the Help & FAQ page.
 *
 *  The ~40 topics are server-rendered static `<details>` (good for SEO +
 *  no-JS), so rather than restructure them into data this reads the DOM:
 *  on each keystroke it walks every `[data-help-topic]`, hides the ones
 *  whose text doesn't match, auto-expands the ones that do, and hides any
 *  section left with no visible topic. Clearing the box (query === "")
 *  restores everything, so no teardown bookkeeping is needed — the page
 *  owns the markup statically, React never re-renders those nodes, and
 *  toggling `hidden`/`open` on them is safe. */
export function HelpSearch() {
  const [q, setQ] = useState("");
  const [empty, setEmpty] = useState(false);

  // Filtering runs in response to a keystroke (a user event), so it lives in
  // the change handler rather than an effect — both more correct per the
  // React docs and clear of the set-state-in-effect rule. The static
  // `[data-help-*]` nodes are server-rendered and React never re-renders
  // them, so mutating `hidden`/`open` imperatively here is race-free.
  function applyFilter(next: string) {
    const query = next.toLowerCase().trim();
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-help-section]"),
    );
    let anyVisible = false;
    for (const section of sections) {
      const topics = Array.from(
        section.querySelectorAll<HTMLElement>("[data-help-topic]"),
      );
      let sectionHasMatch = false;
      for (const topic of topics) {
        const text = (topic.textContent ?? "").toLowerCase();
        const match = query === "" || text.includes(query);
        topic.hidden = !match;
        // Auto-expand matches while searching so the answer is visible
        // without a second tap; collapse again when the box is cleared.
        if (topic instanceof HTMLDetailsElement) {
          topic.open = query !== "" && match;
        }
        if (match) {
          sectionHasMatch = true;
          anyVisible = true;
        }
      }
      section.hidden = !sectionHasMatch;
    }
    setEmpty(query !== "" && !anyVisible);
  }

  function update(next: string) {
    setQ(next);
    applyFilter(next);
  }

  return (
    <div className="mt-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => update(e.target.value)}
          placeholder="Search help…"
          aria-label="Search help topics"
          className="h-11 w-full rounded-lg border border-border/60 bg-card pl-9 pr-9 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
        />
        {q && (
          <button
            type="button"
            onClick={() => update("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {empty && (
        <p className="mt-3 text-sm text-muted-foreground">
          No topics match &ldquo;{q.trim()}&rdquo;. Try a different word, or{" "}
          <a
            href="/contact"
            className="text-foreground underline underline-offset-2"
          >
            ask us directly
          </a>
          .
        </p>
      )}
    </div>
  );
}
