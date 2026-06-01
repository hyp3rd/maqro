import { Footer } from "@/components/shell/Footer";
import { GITHUB_REPO_URL } from "@/lib/links";
import {
  ArrowLeft,
  Camera,
  ChefHat,
  ChevronRight,
  Database,
  Download,
  Fingerprint,
  LifeBuoy,
  LineChart,
  Mail,
  ShieldCheck,
  Sparkles,
  Target,
  Utensils,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Help & FAQ",
  description:
    "Short explainers for Maqro's macro calculator, meal planner, AI features, sync, and data tools — plus the questions everyone asks first.",
  robots: { index: true, follow: true },
};

/** In-app help surface. Short, scannable, written like the
 *  maintainer would explain it to a friend — no marketing
 *  speak, no walls of text. Reachable from:
 *
 *    - Settings → About → Help & FAQ
 *    - Cmd-K → "Help & FAQ"
 *    - Direct URL: /help
 *
 *  Indexable (`robots: { index: true }`) so search engines pick
 *  up explainers like "Maqro how to set TDEE manually" — free
 *  long-tail SEO for the kind of users who actually search. */
export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-5 py-10">
        <Link
          href="/app"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to app
        </Link>

        <header className="mt-6">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Help &amp; FAQ
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Short explainers, the maintainer&apos;s answer to the questions
            people actually ask. Tap a topic to expand.
          </p>
        </header>

        <Section title="Getting started">
          <Topic
            icon={Target}
            title="Set your targets in five minutes"
          >
            Open the Calculator view. Pick gender, age, weight, and height; the
            BMR (Mifflin–St Jeor) and TDEE compute instantly. Choose an activity
            level honestly — the multiplier is the biggest source of error in
            the whole chain. Pick a goal (lose / maintain / gain) and a weekly
            rate. The app derives the target calories and a macro split.
            You&apos;re done.
          </Topic>
          <Topic
            icon={Utensils}
            title="Log meals against the targets"
          >
            Meal Plan view. Search for a food (built-in catalog + your own
            custom foods + live Open Food Facts), set a portion in grams, pick
            the meal slot, hit Add. The day&apos;s totals update at the top and
            the planner tracks how close you&apos;re hitting the targets.
          </Topic>
          <Topic
            icon={Sparkles}
            title="Or let the planner auto-fill the day"
          >
            Auto-fill button on the Meal Plan view. Two paths: the deterministic
            3×3 solver hits your macro targets within tolerance using a
            protein-dominant + carb-dominant + fat-dominant triplet. If AI is
            enabled, Claude Sonnet drafts a coherent day with breakfast-y
            breakfasts (validated against a programmatic coherence checker so
            you never get standalone-oil meals). The button always has a
            fallback so it&apos;ll work even with no connectivity.
          </Topic>
        </Section>

        <Section title="Calculator details">
          <Topic
            icon={Target}
            title="When to override the activity multiplier"
          >
            If you&apos;ve logged consistently for 3–4 weeks and your weight is
            trending up when the app predicts down (or vice versa), your real
            TDEE is different from what the multiplier predicts. The Progress
            view will suggest a recalibration when the divergence exceeds 50
            kcal/day. Apply it via{" "}
            <span className="font-mono">manual TDEE</span> in the Calculator
            view.
          </Topic>
          <Topic
            icon={Target}
            title="Why my target calories feel low"
          >
            The target is clamped at{" "}
            <span className="font-mono">max(BMR, 1200)</span>
            and the weekly rate is capped at 1% of bodyweight. If you&apos;re
            seeing a low number, your rate or your activity-multiplier choice is
            the lever — not the formula.
          </Topic>
        </Section>

        <Section title="Meal planning & recipes">
          <Topic
            icon={Utensils}
            title="Templates vs. recipes — when to use each"
          >
            <strong>Templates</strong> are reusable meal slots: "Greek yogurt
            bowl" is a template you apply to Breakfast on any day. The foods
            expand individually so you can still tweak portions.{" "}
            <strong>Recipes</strong> are named bundles with ingredients +
            cuisine + notes; apply one to a meal slot and the ingredients expand
            the same way. Use templates for habitual meals; use recipes when you
            want to track the dish itself.
          </Topic>
          <Topic
            icon={ChefHat}
            title="Why my AI recipe looks different each time"
          >
            The recipe generator is non-deterministic on purpose — same diet +
            same hint can produce a Greek dinner one time and Korean the next.
            If you want a specific result, narrow the hint ("light Greek dinner
            with chicken, ~600 kcal").
          </Topic>
          <Topic
            icon={Camera}
            title="Camera identification accuracy"
          >
            Sonnet 4.6 vision reads a label or meal photo and returns structured
            macros. It&apos;s good at packaged foods with visible labels, less
            good at prepared meals without context. Always verify the per-100g
            numbers before saving the food — the AI estimates, it doesn&apos;t
            measure.
          </Topic>
        </Section>

        <Section title="Progress & trends">
          <Topic
            icon={LineChart}
            title="What the plateau detector flags"
          >
            A 14-day flat run within ±0.5 kg, computed against the 7-day moving
            average (not raw weigh-ins). The card on Progress shows when the run
            started and how long it&apos;s been. If you&apos;re on a deficit and
            seeing this, the TDEE recalibration card next to it usually has the
            actionable number.
          </Topic>
          <Topic
            icon={LineChart}
            title="Streak counting"
          >
            A "logged day" is any day where at least one food appears across all
            meal slots. Skipping a day breaks the streak; logging anything (even
            a coffee) resets the counter. The daily reminder email respects this
            — we don&apos;t send if you&apos;ve already logged.
          </Topic>
        </Section>

        <Section title="Your data">
          <Topic
            icon={Database}
            title="Local-first means what, exactly"
          >
            Profile, daily logs, weight history, custom foods, templates, and
            recipes all live in IndexedDB on this device by default. Clearing
            your browser&apos;s site data wipes them. Signing in mirrors the
            same data to a Supabase project (RLS-scoped to your row) so multiple
            devices stay in sync.
          </Topic>
          <Topic
            icon={Download}
            title="How to export or back up"
          >
            Settings → Your data → "Save to disk" downloads the full record as
            JSON. "Save to cloud" (signed-in only) puts the same JSON in a
            private per-user Supabase Storage bucket. Imports go through a diff
            dialog — nothing is overwritten until you confirm.
          </Topic>
          <Topic
            icon={Mail}
            title="What we email you"
          >
            Three things, all opt-in: a one-time welcome when you first toggle
            on engagement; an optional daily reminder at the local hour you
            choose, only sent if you haven&apos;t logged anything that day; an
            optional Monday recap with last week&apos;s adherence and weight
            delta. Turn any of them off from Settings → Notifications.
          </Topic>
        </Section>

        <Section title="Account & security">
          <Topic
            icon={Fingerprint}
            title="Passkeys — sign in without a password"
          >
            A passkey lets your device unlock the app with Face ID, Touch ID,
            Windows Hello, or a hardware key. No password, no code. Add one from
            Settings → Passkeys; on devices that have it, the second- factor
            prompt goes away too — the passkey itself is the second factor.
          </Topic>
          <Topic
            icon={ShieldCheck}
            title="Two-factor authentication"
          >
            A leaked password alone isn&apos;t enough to get into your account.
            Settings → Two-factor authentication walks you through adding an
            authenticator app (1Password, Authy, Google Authenticator). On
            trusted devices you can opt to skip the second prompt for 7 days at
            a time.
          </Topic>
          <Topic
            icon={LifeBuoy}
            title="Backup email — the recovery path"
          >
            If you lose access to your primary email (account closed, phone
            stolen, employer-managed inbox revoked), a backup email keeps you
            in. Settings → Backup email adds one with a verification round-trip.
            We never send marketing there — recovery only.
          </Topic>
        </Section>

        <Section title="Billing">
          <Topic
            icon={Sparkles}
            title="The AI cap and what bumps it"
          >
            Free tier gets 25 AI generations per month (auto-fill, recipe
            generate, camera identify combined). AI Plus (€5/mo) lifts it to
            500. Pro (€12/mo) is unlimited and also unlocks cross-device sync,
            cloud backups, and engagement email. Cancel from Settings → Billing
            → the Stripe portal at any time; access stays until the end of the
            paid period.
          </Topic>
          <Topic
            icon={Sparkles}
            title="VAT, invoices, refunds"
          >
            Stripe Tax computes VAT based on your billing address and supports
            B2B reverse-charge if you provide a VAT ID at checkout. Invoices
            arrive by email and are also available from the Stripe customer
            portal (Settings → Billing → Manage). Refund requests in the first
            14 days — open a GitHub issue with the maintainer.
          </Topic>
        </Section>

        <Section title="Troubleshooting">
          <Topic
            icon={Database}
            title="The app feels stuck after an update"
          >
            The service worker may have a stale chunk cached. The update banner
            that pops up after a deploy should handle this — click "Refresh"
            when you see it. If you didn&apos;t see one, hard-reload
            (Cmd-Shift-R / Ctrl-Shift-R) once.
          </Topic>
          <Topic
            icon={Database}
            title="Sync says ‘Sync error’"
          >
            Either your network is wobbly or Supabase is having a moment. Manual
            re-sync via the pill in the topbar retries; the local IndexedDB is
            untouched in the meantime. If it persists for &gt; 1 hour, check the
            Supabase status page.
          </Topic>
          <Topic
            icon={Database}
            title="‘Storage unavailable’ banner at the top"
          >
            Your browser blocked IndexedDB (private/incognito mode in some
            browsers, or storage cleared by the OS). The app falls back to
            in-memory state for the session — nothing persists. Open a
            non-private window to use the app normally.
          </Topic>
        </Section>

        <Section title="Still stuck?">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Open an issue on{" "}
            <a
              href={`${GITHUB_REPO_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              GitHub
            </a>
            . Include the version chip from the footer ({" "}
            <span className="font-mono">/Settings → About</span> shows it too)
            and a one-liner about what you tried — that gets the fastest reply.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            For security issues see{" "}
            <Link
              href="/"
              className="underline underline-offset-2 hover:text-foreground"
            >
              SECURITY.md
            </Link>
            ; do not file a public issue.
          </p>
        </Section>
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Layout primitives                                                 */
/* ---------------------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="mt-3 divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
        {children}
      </div>
    </section>
  );
}

function Topic({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  // Pure HTML `<details>`/`<summary>` keyboard + screen-reader
  // friendly, no JS. The chevron rotates via the `group-open:`
  // variant when expanded.
  return (
    <details className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden sm:px-5">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 text-sm font-medium tracking-tight">
          {title}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="ml-10 mt-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
