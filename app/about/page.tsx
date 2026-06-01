import { Footer } from "@/components/shell/Footer";
import { LogoMark } from "@/components/shell/LogoMark";
import { PageTopBar } from "@/components/shell/PageTopBar";
import {
  BUG_REPORT_URL,
  FEATURE_REQUEST_URL,
  GITHUB_REPO_URL,
  ISSUES_URL,
  LINKEDIN_URL,
  TWITTER_HANDLE,
  TWITTER_URL,
} from "@/lib/links";
import { APP_VERSION } from "@/lib/version";
import {
  Activity,
  AtSign,
  BookOpen,
  Briefcase,
  Bug,
  Code2,
  ExternalLink,
  FileText,
  Lightbulb,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { CheckForUpdatesButton } from "./CheckForUpdatesButton";

export const metadata: Metadata = {
  title: "About - Maqro",
  description:
    "Build info, version, and every Maqro link in one place - status, privacy, terms, contact, GitHub issues, and socials.",
  alternates: { canonical: "/about" },
};

/** /about - the "everything you might want to find" page.
 *
 *  Solves a discoverability problem: the footer carries Pricing /
 *  Status / Terms / Privacy / Contact / Changelog / Report-a-bug /
 *  GitHub, which wraps awkwardly on phones and hides at the
 *  bottom of long pages anyway. This page is a single canonical
 *  destination where all those links live alongside version /
 *  build info and self-service actions (Check for updates,
 *  Request a feature, Report a bug).
 *
 *  Server-rendered apart from the one client island for the
 *  Check-for-updates button - the rest is static content that
 *  ships at zero JS cost. */
export default async function AboutPage() {
  // Two namespaces: `pageTopBar` for the back link, `aboutPage`
  // for everything below. We resolve both at the top so the
  // sections can stay synchronous + plain JSX.
  const tBar = await getTranslations("pageTopBar");
  const t = await getTranslations("aboutPage");
  return (
    <>
      <PageTopBar
        href="/"
        label={tBar("backToHome")}
      />
      <main className="mx-auto max-w-3xl px-safe-or-6 py-8 sm:py-12">
        <header className="flex flex-col items-center gap-3 text-center">
          <LogoMark
            size={36}
            title="Maqro"
          />
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("title")}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {t("tagline")}
          </p>
        </header>

        <section className="mt-10 rounded-xl border border-border/60 bg-card px-5 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("buildLabel")}
              </p>
              <p className="mt-1 font-mono text-lg tabular-nums">
                v{APP_VERSION}
              </p>
            </div>
            <CheckForUpdatesButton />
          </div>
        </section>

        <LinkSection
          title={t("sections.service")}
          items={[
            {
              href: "/status",
              label: t("items.status.label"),
              detail: t("items.status.detail"),
              icon: Activity,
            },
            {
              href: "/pricing",
              label: t("items.pricing.label"),
              detail: t("items.pricing.detail"),
              icon: Tag,
            },
            {
              href: "/changelog",
              label: t("items.changelog.label"),
              detail: t("items.changelog.detail"),
              icon: BookOpen,
            },
          ]}
        />

        <LinkSection
          title={t("sections.help")}
          items={[
            {
              href: "/contact",
              label: t("items.contact.label"),
              detail: t("items.contact.detail"),
              icon: MessageSquare,
            },
            {
              href: FEATURE_REQUEST_URL,
              label: t("items.featureRequest.label"),
              detail: t("items.featureRequest.detail"),
              icon: Lightbulb,
              external: true,
            },
            {
              href: BUG_REPORT_URL,
              label: t("items.bugReport.label"),
              detail: t("items.bugReport.detail"),
              icon: Bug,
              external: true,
            },
            {
              href: ISSUES_URL,
              label: t("items.browseIssues.label"),
              detail: t("items.browseIssues.detail"),
              icon: ExternalLink,
              external: true,
            },
          ]}
        />

        <LinkSection
          title={t("sections.legal")}
          items={[
            {
              href: "/privacy",
              label: t("items.privacy.label"),
              detail: t("items.privacy.detail"),
              icon: ShieldCheck,
            },
            {
              href: "/terms",
              label: t("items.terms.label"),
              detail: t("items.terms.detail"),
              icon: ScrollText,
            },
          ]}
        />

        <LinkSection
          title={t("sections.sourceSocials")}
          items={[
            {
              href: GITHUB_REPO_URL,
              label: t("items.github.label"),
              detail: t("items.github.detail"),
              icon: Code2,
              external: true,
            },
            {
              href: TWITTER_URL,
              label: t("items.twitter.label", { handle: TWITTER_HANDLE }),
              detail: t("items.twitter.detail"),
              icon: AtSign,
              external: true,
            },
            {
              href: LINKEDIN_URL,
              label: t("items.linkedin.label"),
              detail: t("items.linkedin.detail"),
              icon: Briefcase,
              external: true,
            },
            {
              href: "/manifest.webmanifest",
              label: t("items.manifest.label"),
              detail: t("items.manifest.detail"),
              icon: FileText,
              external: true,
            },
          ]}
        />

        <section className="mt-12 rounded-xl border border-border/60 bg-muted/20 px-5 py-6 text-center">
          <Sparkles
            className="mx-auto h-5 w-5 text-muted-foreground"
            aria-hidden
          />
          <p className="mt-2 text-sm font-medium">{t("thanks.title")}</p>
          <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">
            {t("thanks.body")}
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

function LinkSection({
  title,
  items,
}: {
  title: string;
  items: Array<{
    href: string;
    label: string;
    detail: string;
    icon: typeof Activity;
    external?: boolean;
  }>;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.href}>
            <LinkCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinkCard({
  item,
}: {
  item: {
    href: string;
    label: string;
    detail: string;
    icon: typeof Activity;
    external?: boolean;
  };
}) {
  const Icon = item.icon;
  const className =
    "flex items-start gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const body = (
    <>
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-medium">
          {item.label}
          {item.external && (
            <ExternalLink
              aria-hidden
              className="h-3 w-3 shrink-0 text-muted-foreground"
            />
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {item.detail}
        </span>
      </span>
    </>
  );
  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {body}
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      className={className}
    >
      {body}
    </Link>
  );
}
