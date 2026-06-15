import { MfaPendingBanner } from "@/components/auth/MfaPendingBanner";
import { MobileNavDrawer } from "@/components/marketing/MobileNavDrawer";
import { RevealSection } from "@/components/marketing/RevealSection";
import { StructuredData } from "@/components/marketing/StructuredData";
import { UserMenu } from "@/components/marketing/UserMenu";
import { Footer } from "@/components/shell/Footer";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { LogoMark } from "@/components/shell/LogoMark";
import { LogoWordmark } from "@/components/shell/LogoWordmark";
import { getEffectiveUser } from "@/lib/auth/effective-user";
import { GITHUB_REPO_URL } from "@/lib/links";
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  ArrowRight,
  Camera,
  ChefHat,
  CloudOff,
  HeartPulse,
  LineChart,
  Lock,
  Milestone,
  Pill,
  ShieldCheck,
  Sparkles,
  Timer,
  Utensils,
} from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const metadata: Metadata = {
  // The landing-page title shouldn't be templated through the
  // root layout's "%s - Maqro" pattern, since this *is* Maqro's
  // own marketing surface. `absolute` overrides the template.
  title: { absolute: "Maqro - macros, meal planning, and progress tracking" },
  description:
    "A personal macro calculator, meal planner, and weight journal. Private by default, works offline, no ads or tracking. Open source — see exactly what it does with your data.",
};

/** The marketing landing. Server-rendered, minimal JavaScript,
 *  designed to convert without being pushy. Logged-out visitors
 *  land here; clicking "Open the app" takes them to `/app`. The
 *  app itself still runs in guest mode without an account, so
 *  the funnel is "land → try → maybe sign in" rather than
 *  "land → sign in → try". */
export default function LandingPage() {
  // Each section pulls its own namespace from next-intl via
  // `getTranslations()`. They run in parallel during render since
  // Server Components don't await each other - the sections
  // resolve their messages independently.
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* schema.org JSON-LD lives in the initial HTML so Googlebot's
       *  cheap pass picks it up. Renders to a single <script type=
       *  "application/ld+json"> - no visible DOM. */}
      <StructuredData />
      {/* Renders only when the caller is in the AAL1+TOTP-pending
          state; otherwise returns null. Sits above the header so
          a half-authenticated user has a clear "you're not done"
          signal and a one-tap path to /login. */}
      <MfaPendingBanner />
      <SiteHeader />
      <main>
        <Hero />
        <TrustStrip />
        <Features />
        <HowItWorks />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Header                                                            */
/* ---------------------------------------------------------------- */

async function SiteHeader() {
  const t = await getTranslations("header");
  // Server-side auth resolve. The landing is rendered on the server,
  // so we can read the cookie session and conditionally swap "Sign in"
  // for a user-aware affordance. Falls back to signed-out UI when the
  // cookie's gone, when Supabase isn't configured, or when getUser
  // throws - never blocks the landing render on auth.
  let signedInEmail: string | null = null;
  let isAdmin = false;
  // We route through `getEffectiveUser` rather than calling
  // `getUser()` directly so the AAL1+TOTP-pending state masks the
  // signed-in chrome. A user mid-MFA still has a valid cookie in
  // their browser (necessary so they can complete the challenge),
  // but every UI surface that asks "are you signed in?" should
  // answer "no" until they actually finish — otherwise the
  // marketing header leaks their email + admin links to a
  // session that hasn't proven its second factor.
  const effective = await getEffectiveUser();
  try {
    if (effective.user) {
      signedInEmail = effective.user.email ?? null;
      // Role lookup only runs for fully-authenticated users.
      // AAL1-pending users won't see the Admin entry even if
      // they ARE an admin — they need to complete MFA first.
      const supabase = await getSupabaseServer();
      if (supabase) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", effective.user.id)
          .maybeSingle();
        isAdmin = (profile?.role as string | undefined) === "admin";
      }
    }
  } catch {
    signedInEmail = null;
    isAdmin = false;
  }
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 pt-safe backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-safe-or-5">
        <Link
          href="/"
          className="inline-flex items-center text-foreground"
          aria-label={t("homeAria")}
        >
          {/* Wordmark at sm+; just the mark on mobile so the brand
           *  still reads but doesn't crowd the small navbar. Both
           *  inherit currentColor from the parent <Link>. */}
          <LogoMark
            size={22}
            title=""
            className="sm:hidden"
          />
          <LogoWordmark
            size={26}
            title=""
            className="hidden sm:block"
          />
        </Link>
        <nav className="flex items-center gap-1 text-xs sm:gap-3 sm:text-sm">
          <a
            href="#features"
            className="hidden text-muted-foreground hover:text-foreground sm:inline-block"
          >
            {t("features")}
          </a>
          <a
            href="#pricing"
            className="hidden text-muted-foreground hover:text-foreground sm:inline-block"
          >
            {t("pricing")}
          </a>
          <a
            href="#faq"
            className="hidden text-muted-foreground hover:text-foreground sm:inline-block"
          >
            {t("faq")}
          </a>
          {/* Locale switcher sits between the section anchors and the
              auth controls. Always visible (not `sm:`-gated) — the
              footer placement was effectively invisible per user
              feedback; the whole point of a language picker is that
              non-English speakers can find it without hunting. A thin
              divider on sm+ separates it from the section links. */}
          <span
            aria-hidden
            className="hidden h-4 w-px bg-border/60 sm:block"
          />
          <LocaleSwitcher />
          <span
            aria-hidden
            className="hidden h-4 w-px bg-border/60 sm:block"
          />
          {signedInEmail ? (
            // Signed in: account dropdown with Open app, Settings, and
            // Sign out. Replaces the "Sign in" button - surfacing it
            // to a user who's already authenticated reads as confused.
            <UserMenu
              email={signedInEmail}
              isAdmin={isAdmin}
            />
          ) : (
            <>
              {/* Sign in is desktop-only in the bar — on mobile it lives in
                  the drawer below, so the cramped phone header keeps just the
                  primary "Open app" CTA. */}
              <Link
                href="/login"
                className="hidden rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground sm:inline-block"
              >
                {t("signIn")}
              </Link>
              <Link
                href="/app"
                className="ml-1 inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
              >
                {t("openApp")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          )}
          <MobileNavDrawer
            signedIn={signedInEmail !== null}
            sections={[
              { href: "#features", label: t("features") },
              { href: "#pricing", label: t("pricing") },
              { href: "#faq", label: t("faq") },
            ]}
            labels={{
              menu: "Open menu",
              signIn: t("signIn"),
              openApp: t("openApp"),
            }}
          />
        </nav>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- */
/* Hero                                                              */
/* ---------------------------------------------------------------- */

async function Hero() {
  const t = await getTranslations("hero");
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      {/* Subtle radial gradient behind the hero. CSS only - no
          image asset, no JS. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background:radial-gradient(60%_50%_at_50%_0%,rgba(120,120,140,0.10),transparent_70%)]"
      />
      <div className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            {t("tag")}
          </span>
          <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            {t("headlineLine1")}
            <br />
            <span className="text-muted-foreground">{t("headlineLine2")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/app"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              {t("ctaPrimary")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#features"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {t("ctaSecondary")}
            </Link>
          </div>
          {/* "Try with sample data" - drops the visitor into the
              app with a realistic seeded dataset (sample profile +
              a week of meal logs + 14 days of weight history) so
              they can feel the product instead of staring at empty
              forms. The DemoSeed component in AppShell consumes the
              `?demo=1` param and only seeds when IndexedDB is
              empty, so this is safe to leave linked permanently. */}
          <p className="mt-4">
            <Link
              href="/app?demo=1"
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t("ctaSample")}
            </Link>
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t("ctaFootnote")}
          </p>
        </div>

        {/* Stylized macro card - visual centerpiece below the
            CTA. Pure HTML/CSS, no screenshot, scales perfectly
            and stays sharp on retina. */}
        <div className="mx-auto mt-16 max-w-2xl">
          <MacroCardPreview />
        </div>
      </div>
    </section>
  );
}

async function MacroCardPreview() {
  const t = await getTranslations("macroCard");
  return (
    <div
      role="img"
      aria-label={t("aria")}
      className="rounded-2xl border border-border/60 bg-card p-6 shadow-xl shadow-foreground/[0.03]"
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("dayLabel")}</span>
        <span className="font-mono tabular-nums">{t("calories")}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/80"
          style={{ width: "88%" }}
        />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-4 text-center">
        <MacroPill
          label={t("protein")}
          current={142}
          target={165}
          unit="g"
        />
        <MacroPill
          label={t("carbs")}
          current={208}
          target={220}
          unit="g"
        />
        <MacroPill
          label={t("fat")}
          current={61}
          target={70}
          unit="g"
        />
      </div>
    </div>
  );
}

function MacroPill({
  label,
  current,
  target,
  unit,
}: {
  label: string;
  current: number;
  target: number;
  unit: string;
}) {
  const pct = Math.min(100, Math.round((current / target) * 100));
  return (
    <div className="rounded-lg border border-border/40 bg-background/60 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
        {current}
        <span className="text-xs font-normal text-muted-foreground">
          /{target}
          {unit}
        </span>
      </p>
      <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
        {pct}%
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Trust strip                                                       */
/* ---------------------------------------------------------------- */

async function TrustStrip() {
  const t = await getTranslations("trust");
  return (
    <RevealSection className="border-b border-border/60 bg-muted/20">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5 py-6 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3 w-3" /> {t("localFirst")}
        </span>
        <span>·</span>
        <span className="inline-flex items-center gap-1.5">
          <CloudOff className="h-3 w-3" /> {t("offline")}
        </span>
        <span>·</span>
        <span>{t("noAnalytics")}</span>
        <span>·</span>
        <span>{t("noAds")}</span>
        <span>·</span>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("openSource")}
        </a>
      </div>
    </RevealSection>
  );
}

/* ---------------------------------------------------------------- */
/* Features                                                          */
/* ---------------------------------------------------------------- */

async function Features() {
  const t = await getTranslations("features");
  // Keys mirror messages/en.json under `features.items.*`. Icons
  // stay in code - they're not translatable content.
  const items = [
    { key: "mealPlanning", icon: Utensils },
    { key: "logging", icon: Camera },
    { key: "recipes", icon: ChefHat },
    { key: "fasting", icon: Timer },
    { key: "goalPhases", icon: Milestone },
    { key: "healthJournal", icon: HeartPulse },
    { key: "micronutrients", icon: Pill },
    { key: "trends", icon: LineChart },
    { key: "ownership", icon: ShieldCheck },
  ] as const;
  return (
    <RevealSection
      id="features"
      className="border-b border-border/60"
    >
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.key}
                className="rounded-xl border border-border/60 bg-card p-5 transition-colors hover:bg-accent/30"
              >
                <Icon className="h-5 w-5 text-foreground" />
                <h3 className="mt-3 font-display text-base font-semibold tracking-tight">
                  {t(`items.${it.key}.title`)}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t(`items.${it.key}.body`)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </RevealSection>
  );
}

/* ---------------------------------------------------------------- */
/* How it works                                                      */
/* ---------------------------------------------------------------- */

async function HowItWorks() {
  const t = await getTranslations("howItWorks");
  const steps = [
    { n: "01", key: "set" },
    { n: "02", key: "log" },
    { n: "03", key: "see" },
  ] as const;
  return (
    <RevealSection className="border-b border-border/60 bg-muted/10">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="relative"
            >
              <p className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                {s.n}
              </p>
              <h3 className="mt-2 font-display text-lg font-semibold tracking-tight">
                {t(`steps.${s.key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`steps.${s.key}.body`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

/* ---------------------------------------------------------------- */
/* Pricing                                                           */
/* ---------------------------------------------------------------- */

async function Pricing() {
  const t = await getTranslations("pricing");
  // Price + cadence stay in code: prices are jurisdiction-aware and
  // tied to Stripe configuration, the cadence is a translatable
  // common-noun ("per month" / "forever"). Everything else lives
  // in `messages/en.json` under `pricing.plans.*`.
  const plans = [
    {
      key: "free",
      price: "€0",
      cadence: t("forever"),
      href: "/app",
      accent: false,
    },
    {
      key: "plus",
      price: "€5",
      cadence: t("perMonth"),
      href: "/app?upgrade=plus",
      accent: true,
    },
    {
      key: "pro",
      price: "€12",
      cadence: t("perMonth"),
      href: "/app?upgrade=pro",
      accent: false,
    },
  ] as const;
  return (
    <RevealSection
      id="pricing"
      className="border-b border-border/60"
    >
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">{t("trialNote")}</p>
        </div>
        <div className="mt-4 text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            See the full feature comparison →
          </Link>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {plans.map((p) => {
            // `t.raw` returns the underlying JSON value (an array
            // of strings here) - the typed `t()` is string-only.
            const features = t.raw(`plans.${p.key}.features`) as string[];
            return (
              <div
                key={p.key}
                className={`relative flex flex-col rounded-xl border bg-card p-6 ${
                  p.accent
                    ? "border-foreground/40 shadow-lg shadow-foreground/[0.04]"
                    : "border-border/60"
                }`}
              >
                {p.accent && (
                  <span className="absolute -top-2.5 left-6 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
                    {t("recommended")}
                  </span>
                )}
                <h3 className="font-display text-lg font-semibold tracking-tight">
                  {t(`plans.${p.key}.name`)}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`plans.${p.key}.tagline`)}
                </p>
                <p className="mt-5 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-semibold tracking-tight">
                    {p.price}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    / {p.cadence}
                  </span>
                </p>
                <ul className="mt-6 flex-1 space-y-2 text-sm">
                  {features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2"
                    >
                      <span
                        aria-hidden
                        className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className={`mt-6 inline-flex items-center justify-center gap-1 rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 ${
                    p.accent
                      ? "bg-foreground text-background"
                      : "border border-border bg-background text-foreground"
                  }`}
                >
                  {t(`plans.${p.key}.cta`)}
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </RevealSection>
  );
}

/* ---------------------------------------------------------------- */
/* FAQ                                                               */
/* ---------------------------------------------------------------- */

async function Faq() {
  const t = await getTranslations("faq");
  const keys = [
    "storage",
    "account",
    "ai",
    "cancel",
    "offline",
    "gdpr",
    "source",
  ] as const;
  return (
    <RevealSection
      id="faq"
      className="border-b border-border/60 bg-muted/10"
    >
      <div className="mx-auto max-w-3xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("title")}
          </h2>
        </div>
        {/* `<details>` elements aren't valid children of `<dl>`
            (only <dt>/<dd>/<div>/<script>/<template>), so this is
            a plain div. The collapsible affordance comes from
            `<details>/<summary>` - keyboard / screen-reader
            friendly without any JS. */}
        <div className="mt-12 divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
          {keys.map((k) => (
            <details
              key={k}
              className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                <span>{t(`items.${k}.q`)}</span>
                <span
                  aria-hidden
                  className="text-muted-foreground transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`items.${k}.a`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </RevealSection>
  );
}

/* ---------------------------------------------------------------- */
/* Final CTA                                                         */
/* ---------------------------------------------------------------- */

async function FinalCta() {
  const t = await getTranslations("finalCta");
  return (
    <RevealSection className="border-b border-border/60">
      <div className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("title")}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {t("body")}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            {t("primary")}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("secondary")}
          </Link>
        </div>
      </div>
    </RevealSection>
  );
}
