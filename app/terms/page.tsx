import { PageTopBar } from "@/components/shell/PageTopBar";
import { GITHUB_REPO_URL } from "@/lib/links";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Conditions - Maqro",
  description:
    "Terms and conditions for using Maqro, including health disclaimers, data handling, and third-party services.",
};

/** Plain server-rendered page - no client state, no interactivity. The
 *  content is intentionally readable: short paragraphs, declarative
 *  sentences, no fine print buried in a wall of text. The maintainer's
 *  draft, not legal advice (see the note up top).
 *
 *  Body stays in English even when the locale is `it` — see the
 *  "authoritative" note rendered at the top of the page when a
 *  non-English locale is active. Translating legal copy without
 *  counsel review would create more risk than value; the chrome
 *  (back-link, title, note) is translated for UX consistency. */
export default async function TermsPage() {
  const tBar = await getTranslations("pageTopBar");
  const tLegal = await getTranslations("legalPage");
  const lastUpdated = "2026-05-19";
  return (
    <>
      <PageTopBar label={tBar("backToApp")} />
      <main className="mx-auto min-h-screen max-w-3xl px-safe-or-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Terms &amp; Conditions
        </h1>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {tLegal("authoritativeNote")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated: <time dateTime={lastUpdated}>{lastUpdated}</time>
        </p>

        <aside className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">This is the maintainer&apos;s draft.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Written in good faith but <strong>not legal advice</strong> and not
            reviewed by counsel. If you operate a deployment of Maqro for users
            beyond yourself, have a lawyer in your jurisdiction review and adapt
            this document for your context. Source for this page is in the Git
            repository - issue a pull request if something needs fixing.
          </p>
        </aside>

        <section className="mt-8 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            1. About this app
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Maqro (&ldquo;the app&rdquo;) is an open-source personal macro
            calculator, meal planner, and weight-tracking journal. It is
            provided free of charge and without warranty. The source code and
            complete history of changes are public at{" "}
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {GITHUB_REPO_URL.replace(/^https?:\/\//, "")}
            </a>
            .
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            2. Acceptance
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            By using the app you confirm that you have read these terms and
            agree to them. If you do not agree, do not use the app.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            3. Health, safety, and food disclaimer
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Maqro produces estimates and suggestions. It is{" "}
            <strong>not a medical device</strong>, not a substitute for
            professional advice, and not a replacement for consultation with a
            qualified physician, registered dietitian, mental health
            professional, or other healthcare provider.
          </p>
          <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong>Caloric and macronutrient estimates&nbsp;</strong> are
              derived from textbook formulas (Mifflin–St Jeor, activity
              multipliers) that are accurate on average but may diverge 10–20%
              for any individual. Calibrate against your own measured outcomes;
              do not rely on the app&apos;s targets as ground truth.
            </li>
            <li>
              <strong>Food data</strong> comes from a built-in catalog, your own
              custom entries, and the public Open Food Facts database. Open Food
              Facts is community-maintained - its entries can be incomplete,
              mis-labelled, or outdated. Verify nutrient values against the
              actual product label before consuming.
            </li>
            <li>
              <strong>Allergies and intolerances</strong> are filtered
              best-effort by name matching, which is inherently imperfect.
              <strong>
                {" "}
                Always read the ingredient list of the actual product
              </strong>{" "}
              before eating it. The app&apos;s allergy filter is a convenience,
              not a safety mechanism. Do not rely on it if a mistake could harm
              you.
            </li>
            <li>
              <strong>AI-generated meal plans and recipes</strong> are
              suggestions only. The model can produce combinations that are
              nutritionally fine but culturally odd, or vice versa, and may not
              account for specific medical conditions, medications (e.g. MAOIs
              and tyramine, warfarin and vitamin K), pregnancy, breastfeeding,
              religious dietary laws, or other constraints not captured in your
              profile. Review every generated plan against your actual
              situation.
            </li>
            <li>
              <strong>Weight goals</strong> are not appropriate for everyone. If
              you have or have had an eating disorder, disordered relationship
              with food, or are at elevated risk, do not use this app without
              guidance from a qualified professional. Aggressive caloric
              deficits can be harmful at any body composition.
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The maintainer of Maqro <strong>is not responsible</strong> for
            health outcomes, allergic reactions, weight changes, eating
            patterns, or any other physical, mental, or emotional consequence of
            acting on information the app provides.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            4. No warranties
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The app is provided <strong>&ldquo;as is&rdquo;</strong>, without
            warranty of any kind, express or implied, including but not limited
            to fitness for a particular purpose, accuracy, merchantability, and
            non-infringement. The maintainer makes no guarantee that the app
            will be available, error-free, or continuously maintained.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            5. Limitation of liability
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            To the maximum extent permitted by applicable law, the maintainer of
            Maqro is not liable for any direct, indirect, incidental, special,
            consequential, or exemplary damages arising out of or in connection
            with your use of the app. This includes, without limitation, damages
            for personal injury, loss of profits, loss of data, or business
            interruption.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Some jurisdictions do not allow the exclusion of certain warranties
            or limitations of liability - in those jurisdictions, the above
            exclusions and limitations apply only to the extent permitted.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">6. Privacy</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            What Maqro stores, what it doesn&apos;t, how third-party services
            are used, and how to delete your account is documented separately at{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2 hover:text-foreground"
            >
              /privacy
            </Link>
            . The short version: data lives in your browser by default; signing
            in mirrors it to a Supabase project; no analytics, no ads, no
            tracking.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            7. Account security
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You are responsible for keeping your sign-in credentials safe. That
            means the email account tied to your sign-in, any authenticator app
            used for two-factor authentication, and any passkey-bearing device
            you&apos;ve enrolled (a phone, a laptop, a hardware key). Remove a
            passkey from Settings → Passkeys if the device is lost or sold;
            remove a trusted device from Settings → Trusted devices if the
            browser was on a shared or public machine.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Maqro never asks you for a passkey, a TOTP code, or a sign-in link
            by email, chat, or phone. If someone does, they&apos;re not us.
            Report suspected account compromise via the contact link in the
            footer.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            8. AI features
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            AI features (Auto-fill meal plan, Generate recipe) are{" "}
            <strong>opt-in</strong> per deployment. They produce suggestions,
            not prescriptions. The model may hallucinate, omit allergens despite
            being told to filter, suggest unrealistic portions, or pair foods in
            ways that aren&apos;t appropriate for you. Always sanity-check AI
            output before acting on it, and never rely on the AI to keep you
            safe from a known allergen - read the ingredient list yourself.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            9. Open source
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Maqro is licensed under Apache License 2.0. The full source and
            license terms are at{" "}
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {GITHUB_REPO_URL.replace(/^https?:\/\//, "")}
            </a>
            . If you fork or redeploy the app, these terms describe the
            maintainer&apos;s position; your own deployment&apos;s terms may
            differ.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            10. Changes to these terms
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            These terms may be updated. Material changes will be accompanied by
            a bumped &ldquo;Last updated&rdquo; date at the top of this page.
            Continued use after a change constitutes acceptance of the updated
            terms. The full revision history is in the Git log of this
            repository.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            11. Contact
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            For questions, security reports, or suggestions, open an issue at{" "}
            <a
              href={`${GITHUB_REPO_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {GITHUB_REPO_URL.replace(/^https?:\/\//, "")}/issues
            </a>
            . Please do not include sensitive personal data in public issues.
          </p>
        </section>
      </main>
    </>
  );
}
