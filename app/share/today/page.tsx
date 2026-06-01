import { getAppUrl } from "@/lib/app-url";
import {
  buildShareBadgePageUrl,
  buildShareBadgeUrl,
  parseShareBadgeParams,
  type ShareBadgeNumbers,
} from "@/lib/share-badge";
import { isSigningEnabled, verifyShareBadge } from "@/lib/share-badge-signing";
import type { Metadata } from "next";
import Link from "next/link";

/** Unfurl page for the "Share today" social card.
 *
 *  When a user shares their day from the meal-plan view, the URL
 *  that travels (via Web Share API or clipboard) is THIS page —
 *  `/share/today?…&sig=…`. The OG meta tags below point at the
 *  PNG endpoint, so Twitter / iMessage / LinkedIn / Slack render
 *  the branded card preview without ever loading the JS bundle.
 *  Humans who click the link land here and see the card embedded
 *  + a "try it" CTA — the conversion surface for the share.
 *
 *  Signing: when `SHARE_BADGE_SECRET` is set, both this page and
 *  the `/api/share/today/og` route require a valid HMAC. Invalid
 *  links render an explainer rather than 404'ing — the user
 *  clicked a real Maqro link, just one whose params got tampered
 *  with or chat-app-mangled.
 *
 *  No analytics, no logging of the numbers — the public page is
 *  ephemeral and the privacy story matches the rest of the app
 *  ([README.md](../../../README.md)). */

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function resolveParams(
  searchParams: SearchParams,
): Promise<
  { ok: true; numbers: ShareBadgeNumbers; sig?: string } | { ok: false }
> {
  const raw = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") usp.set(k, v);
  }
  const numbers = parseShareBadgeParams(usp);
  if (isSigningEnabled()) {
    const sig = usp.get("sig") ?? "";
    const ok = await verifyShareBadge(numbers, sig);
    if (!ok) return { ok: false };
    return { ok: true, numbers, sig };
  }
  return { ok: true, numbers };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const resolved = await resolveParams(searchParams);
  if (!resolved.ok) {
    return { title: "Shared day", robots: { index: false, follow: false } };
  }
  const { numbers, sig } = resolved;
  const origin = getAppUrl();
  const imageUrl = buildShareBadgeUrl(origin, numbers, sig);
  const pageUrl = buildShareBadgePageUrl(origin, numbers, sig);

  const description =
    numbers.caloriesTarget > 0
      ? `${numbers.caloriesCurrent.toLocaleString()} / ${numbers.caloriesTarget.toLocaleString()} kcal · P ${numbers.proteinCurrent}g · C ${numbers.carbsCurrent}g · F ${numbers.fatCurrent}g`
      : `${numbers.caloriesCurrent.toLocaleString()} kcal · P ${numbers.proteinCurrent}g · C ${numbers.carbsCurrent}g · F ${numbers.fatCurrent}g`;

  return {
    title: "A day on Maqro",
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      type: "article",
      title: "A day on Maqro",
      description,
      url: pageUrl,
      siteName: "Maqro",
      images: [
        { url: imageUrl, width: 1200, height: 630, alt: "Maqro day summary" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "A day on Maqro",
      description,
      images: [imageUrl],
    },
    // The numbers themselves aren't sensitive but the shared URL is
    // ephemeral by design — keeping these out of Google avoids years-
    // old share links accumulating in search results.
    robots: { index: false, follow: false },
  };
}

export default async function ShareTodayPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const resolved = await resolveParams(searchParams);
  if (!resolved.ok) return <InvalidLink />;
  const { numbers, sig } = resolved;
  const origin = getAppUrl();
  const imageUrl = buildShareBadgeUrl(origin, numbers, sig);

  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-safe-or-6 py-12">
      <header className="space-y-2 text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Shared from Maqro
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          A day in macros
        </h1>
      </header>

      <div className="w-full overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {/* The card itself. Width-fit lets the recipient see the
            actual artifact, not a re-styled HTML reconstruction —
            so the link click confirms what was unfurled on the
            social platform. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Maqro day summary"
          width={1200}
          height={630}
          className="block h-auto w-full"
        />
      </div>

      <section className="w-full rounded-lg border border-border/60 bg-card px-5 py-4 text-sm">
        <div className="grid grid-cols-4 gap-3 text-center">
          <Cell
            label="kcal"
            value={
              numbers.caloriesTarget > 0
                ? `${numbers.caloriesCurrent.toLocaleString()} / ${numbers.caloriesTarget.toLocaleString()}`
                : numbers.caloriesCurrent.toLocaleString()
            }
          />
          <Cell
            label="Protein"
            value={`${numbers.proteinCurrent}g${numbers.proteinTarget > 0 ? ` / ${numbers.proteinTarget}g` : ""}`}
          />
          <Cell
            label="Carbs"
            value={`${numbers.carbsCurrent}g${numbers.carbsTarget > 0 ? ` / ${numbers.carbsTarget}g` : ""}`}
          />
          <Cell
            label="Fat"
            value={`${numbers.fatCurrent}g${numbers.fatTarget > 0 ? ` / ${numbers.fatTarget}g` : ""}`}
          />
        </div>
      </section>

      <div className="flex flex-col items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Plan your day
        </Link>
        <p className="text-[11px] text-muted-foreground">
          Free. No sign-up needed.
        </p>
      </div>
    </main>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-base font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function InvalidLink() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-safe-or-6 py-16 text-center">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        This share link looks broken
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        The numbers in the URL don&apos;t match the signature, which usually
        means a chat app trimmed part of the link. Ask the sender to share
        again, or head straight to Maqro to plan your own day.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Open Maqro
      </Link>
    </main>
  );
}
