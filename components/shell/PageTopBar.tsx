import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/** Compact top bar used on the public-information pages (contact,
 *  terms, privacy). Two responsibilities:
 *
 *    1. **Safe-area top padding** - on iOS, the back link otherwise
 *       sits under the camera notch when the page is scrolled to
 *       the top. `pt-safe` reserves the inset; the sticky
 *       positioning keeps the bar pinned even as the user scrolls.
 *
 *    2. **Always-visible back affordance** - the contact page used
 *       to surface a back link only AFTER submission, leaving the
 *       user reliant on the browser back button. Mounting this in
 *       the page chrome gives an explicit escape hatch on every
 *       state.
 *
 *  Stays sync (not async with server-side `getTranslations`)
 *  because one caller — `/t/import` — is a Client Component, and
 *  client code cannot render an async server component directly.
 *  Callers own the `label` and translate it themselves: server
 *  pages use `getTranslations("pageTopBar")`, client pages use
 *  `useTranslations("pageTopBar")`. The `pageTopBar.backToHome`
 *  and `pageTopBar.backToApp` keys are the two canonical labels. */
export function PageTopBar({
  href = "/app",
  label = "Back to app",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <div className="sticky top-0 z-30 border-b border-border/60 bg-background/85 pt-safe backdrop-blur">
      <div className="mx-auto flex h-11 max-w-3xl items-center px-safe-or-5">
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {label}
        </Link>
      </div>
    </div>
  );
}
