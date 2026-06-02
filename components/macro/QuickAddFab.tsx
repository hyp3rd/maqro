"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

/** Thumb-zone quick-add for the meal log.
 *
 *  The AddFoodForm sits near the top of the Meal Plan view (right under
 *  Daily Totals); once the user scrolls down into a day's logged meals
 *  it's off-screen, so "log another food" means scrolling all the way
 *  back up. This FAB floats in the bottom-right thumb arc — just above the
 *  mobile tab bar — and on tap focuses the food-search input, which on
 *  mobile also brings it into view and (in the same user gesture) opens
 *  the keyboard. Logging is then always one reachable tap away.
 *
 *  Mobile-only (`md:hidden`, mirroring the bottom nav — desktop keeps the
 *  always-visible form plus sidebar). It auto-hides while the form is
 *  already on screen so it never sits redundantly on top of it. Rendered
 *  inside MealPlanner so it only appears on the meal-log view. */
export function QuickAddFab() {
  // Start hidden: on first paint the form is at the top and visible, so
  // showing the FAB then would flash it over the form. The observer
  // flips this on once the user scrolls the form away.
  const [show, setShow] = useState(false);

  useEffect(() => {
    const form = document.getElementById("add-food-form");
    if (!form || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setShow(entry ? !entry.isIntersecting : false),
      // A sliver of the form peeking at the very top/bottom edge still
      // counts as "away" — only treat it as on-screen once a real chunk
      // (≥ 32px) is showing, so the FAB returns promptly as you scroll.
      { rootMargin: "-32px 0px -32px 0px" },
    );
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  function focusSearch() {
    const input = document.getElementById("foodSearch");
    if (!input) return;
    // Focus synchronously inside the tap gesture: iOS only opens the
    // keyboard for an in-gesture focus, and the focus itself scrolls the
    // field into view. A manual smooth-scroll would fight that, so we
    // let the browser place it.
    input.focus();
  }

  return (
    <button
      type="button"
      onClick={focusSearch}
      aria-label="Add food"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      className={cn(
        "fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-black/5 transition-[transform,opacity] duration-200 active:scale-95 md:hidden",
        // Clear the bottom tab bar (≈ 58px + safe-area) with breathing room.
        "bottom-[calc(env(safe-area-inset-bottom)+5rem)]",
        show
          ? "scale-100 opacity-100"
          : "pointer-events-none scale-90 opacity-0",
      )}
    >
      <Plus className="h-6 w-6" />
    </button>
  );
}
