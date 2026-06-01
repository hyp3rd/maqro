"use client";

import { setLocaleAction } from "@/app/actions/set-locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locale";
import { useTransition } from "react";
import { Check, ChevronDown, Globe, Loader2 } from "lucide-react";
import { useLocale } from "next-intl";

/** Locale picker for the site header.
 *
 *  Implemented as a Radix DropdownMenu rather than a flat row of
 *  pills — the inline row was fine for two locales but degrades
 *  visually the moment a third appears (every item competes for
 *  attention; the active one has to be distinguished by colour
 *  alone). A dropdown scales: one button, N items, the active
 *  one wins by virtue of being the trigger label.
 *
 *  Labels use **endonyms** (each language's own name) — "English",
 *  "Italiano", "Français" — not English names of foreign
 *  languages. This is the convention every well-built i18n picker
 *  follows: a French speaker scanning the menu finds "Français",
 *  not "French".
 *
 *  Pending state: while the server action runs we show a spinner
 *  in the trigger and dim the menu items. `useTransition` keeps
 *  the trigger interactive (the user can dismiss the menu) while
 *  the cookie write + revalidate complete. */

interface LocaleMeta {
  /** The language's own name. Always rendered in its own script. */
  endonym: string;
  /** Short label for the trigger — used at narrow widths where
   *  the endonym is too long to fit. ISO 639-1 uppercase. */
  shortCode: string;
}

const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { endonym: "English", shortCode: "EN" },
  it: { endonym: "Italiano", shortCode: "IT" },
};

export function LocaleSwitcher() {
  const current = useLocale() as Locale;
  const [isPending, startTransition] = useTransition();

  function onSelect(next: Locale) {
    if (next === current) return;
    const fd = new FormData();
    fd.set("locale", next);
    // The server action handles validation + cookie write +
    // revalidatePath. We don't await — useTransition wires the
    // pending state into React's concurrent renderer so the
    // menu stays responsive.
    startTransition(() => setLocaleAction(fd));
  }

  const currentMeta = LOCALE_META[current];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        aria-label="Choose language"
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        {isPending ? (
          <Loader2
            className="h-3.5 w-3.5 animate-spin"
            aria-hidden
          />
        ) : (
          <Globe
            className="h-3.5 w-3.5"
            aria-hidden
          />
        )}
        {/* Endonym at sm+, short code on mobile so the trigger
            stays compact next to dense nav controls. */}
        <span className="hidden sm:inline">{currentMeta.endonym}</span>
        <span className="font-medium sm:hidden">{currentMeta.shortCode}</span>
        <ChevronDown
          className="h-3 w-3 opacity-70"
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[10rem]"
      >
        {/* Plain `DropdownMenuItem`s rather than `RadioItem`s —
            the shadcn RadioItem ships a hard-coded dot indicator
            for the active item, which collided with our own
            trailing Check (one item ended up with two "you're
            here" marks). A single-source-of-truth check on the
            right edge reads more clearly than a left-side dot. */}
        {SUPPORTED_LOCALES.map((locale) => {
          const meta = LOCALE_META[locale];
          const active = locale === current;
          return (
            <DropdownMenuItem
              key={locale}
              onSelect={(e) => {
                // Default behaviour closes the menu, which is what
                // we want. We just need our handler to fire first.
                e.preventDefault();
                onSelect(locale);
              }}
              className="flex items-center justify-between gap-3 px-2"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium leading-tight">
                  {meta.endonym}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {meta.shortCode}
                </span>
              </span>
              {active && (
                <Check
                  className="h-3.5 w-3.5 text-foreground"
                  aria-hidden
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
