import { ChangelogTail } from "@/components/changelog/ChangelogTail";
import { EntryItem } from "@/components/changelog/EntryItem";
import { MarkSeenOnMount } from "@/components/changelog/MarkSeenOnMount";
import { Footer } from "@/components/shell/Footer";
import { CHANGELOG, LATEST_CHANGELOG_ID } from "@/lib/changelog";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

/** Number of entries server-rendered on first paint. The rest are
 *  passed to `<ChangelogTail>` and revealed on click. Tuned to fit
 *  roughly one viewport on a desktop — most visitors come for the
 *  latest, scan, and leave; everyone else gets the "Show older"
 *  affordance. */
const INITIAL_VISIBLE = 5;

export const metadata: Metadata = {
  title: "Changelog · Maqro",
  description:
    "Release notes for Maqro - what's new, what's changed, and what's coming.",
};

/** Public changelog page. Server-rendered from the static
 *  CHANGELOG array in lib/changelog.ts.
 *
 *  Page CHROME is translated (back link, title, subtitle); entry
 *  bodies stay in English. Entries are content (release notes),
 *  not UI labels — translating each release note would require a
 *  process change ("write each entry in both languages") that
 *  isn't worth the maintenance overhead until we see real Italian
 *  user adoption.
 *
 *  Note: we dropped `force-static` here because the chrome
 *  resolves per-request via locale cookie + Accept-Language; a
 *  build-time static render would freeze one locale's chrome and
 *  show it to everyone. The body is still cheap to render — no
 *  database lookups, just iterating CHANGELOG.
 *
 *  The "mark as seen" side-effect is intentionally a client-only
 *  component (MarkSeenOnMount) so the server render stays pure. */

export default async function ChangelogPage() {
  const tBar = await getTranslations("pageTopBar");
  const t = await getTranslations("changelogPage");
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-12">
          <header className="mb-8 space-y-2">
            <Link
              href="/"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← {tBar("backToHome")}
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </header>

          <ol className="space-y-10">
            {CHANGELOG.slice(0, INITIAL_VISIBLE).map((entry) => (
              <EntryItem
                key={entry.id}
                entry={entry}
              />
            ))}
            <ChangelogTail entries={CHANGELOG.slice(INITIAL_VISIBLE)} />
          </ol>
        </div>
      </main>
      <Footer />
      <MarkSeenOnMount latestId={LATEST_CHANGELOG_ID} />
    </div>
  );
}
