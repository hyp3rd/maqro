"use client";

import { ChangelogIndicator } from "@/components/changelog/ChangelogIndicator";
import { GITHUB_REPO_URL } from "@/lib/links";
import { APP_VERSION } from "@/lib/version";
import { useState } from "react";
import { Bug } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { BugReportDialog } from "./BugReportDialog";
import { LogoMark } from "./LogoMark";
import { LogoWordmark } from "./LogoWordmark";

/** GitHub mark, inlined because lucide dropped brand icons in v1.x.
 *  The path comes from the public Octicons set under MIT license; using
 *  the GitHub logo as a link to a GitHub repo is permitted by GitHub's
 *  brand guidelines. */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .297a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.16c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.39 1.24-3.23-.13-.31-.54-1.55.11-3.22 0 0 1.01-.33 3.31 1.23a11.5 11.5 0 0 1 6.02 0c2.3-1.56 3.31-1.23 3.31-1.23.65 1.67.24 2.91.12 3.22.77.84 1.24 1.92 1.24 3.23 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58A12 12 0 0 0 12 .297z" />
    </svg>
  );
}

/** Persistent footer for app and login pages. Houses the Terms link,
 *  the GitHub repo icon, and the "Report a bug" trigger. Kept compact
 *  so it doesn't compete with content above it. */
export function Footer() {
  const [bugOpen, setBugOpen] = useState(false);
  const t = useTranslations("footer");
  return (
    <>
      <footer
        aria-label="Site footer"
        className="border-t border-border/60 bg-background/60 px-safe-or-5 py-3 pb-safe-plus-2 text-[11px] text-muted-foreground"
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-foreground/80 sm:text-left">
            <LogoMark
              size={16}
              title="Maqro"
              className="sm:hidden"
            />
            <LogoWordmark
              size={18}
              title="Maqro"
              className="hidden sm:block"
            />
            <span>{t("tagline")}</span>
            <span
              className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80"
              title={t("appVersionTitle")}
            >
              v{APP_VERSION}
            </span>
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
            <Link
              href="/about"
              className="whitespace-nowrap hover:text-foreground"
            >
              {t("about")}
            </Link>
            <Link
              href="/pricing"
              className="whitespace-nowrap hover:text-foreground"
            >
              {t("pricing")}
            </Link>
            <Link
              href="/status"
              className="whitespace-nowrap hover:text-foreground"
            >
              {t("status")}
            </Link>
            <Link
              href="/terms"
              className="whitespace-nowrap hover:text-foreground"
            >
              {t("terms")}
            </Link>
            <Link
              href="/privacy"
              className="whitespace-nowrap hover:text-foreground"
            >
              {t("privacy")}
            </Link>
            <Link
              href="/contact"
              className="whitespace-nowrap hover:text-foreground"
            >
              {t("contact")}
            </Link>
            <ChangelogIndicator />
            <button
              type="button"
              onClick={() => setBugOpen(true)}
              className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
              aria-label={t("reportBugAria")}
            >
              <Bug className="h-3 w-3" />
              <span>{t("reportBug")}</span>
            </button>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
              aria-label={t("githubAria")}
              title={t("githubTitle")}
            >
              <GithubIcon className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </footer>
      <BugReportDialog
        open={bugOpen}
        onOpenChange={setBugOpen}
      />
    </>
  );
}
