import { PageTopBar } from "@/components/shell/PageTopBar";
import { GITHUB_REPO_URL } from "@/lib/links";
import { isOfficialHost } from "@/lib/official-host";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy - Maqro",
  description:
    "What Maqro stores, what it doesn't, how third-party services are used, and how to delete your data.",
};

/** Privacy policy split out from /terms so users (and regulators) can
 *  find it without skimming a legal wall. The substance is the same as
 *  the privacy sections that used to live inside /terms; the Terms page
 *  now links here for anything privacy-related.
 *
 *  English body is authoritative (same rationale as /terms — see
 *  [app/terms/page.tsx](../terms/page.tsx)). Chrome is translated;
 *  the policy text intentionally stays in one language across
 *  locales. */
export default async function PrivacyPage() {
  const tBar = await getTranslations("pageTopBar");
  const tLegal = await getTranslations("legalPage");
  const lastUpdated = "2026-05-19";
  // The "maintainer's draft" notice is for forks / self-hosters / local dev —
  // on the official site these ARE the terms, so it's hidden there.
  const showDraftNotice = !(await isOfficialHost());
  return (
    <>
      <PageTopBar label={tBar("backToApp")} />
      <main className="mx-auto min-h-screen max-w-3xl px-safe-or-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {tLegal("authoritativeNote")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated: <time dateTime={lastUpdated}>{lastUpdated}</time>
        </p>

        {showDraftNotice && (
          <aside className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-medium">This is the maintainer&apos;s draft.</p>
            <p className="mt-1 text-xs leading-relaxed">
              Written in good faith but <strong>not legal advice</strong> and
              not reviewed by counsel. If you operate a deployment of Maqro for
              users beyond yourself - especially with users in the EU/UK - have
              a lawyer in your jurisdiction review and adapt this document.
              Source for this page is in the Git repository - issue a pull
              request if something needs fixing.
            </p>
          </aside>
        )}

        <section className="mt-8 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">1. Summary</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Maqro is built around the principle that your data stays yours. We
            do not run analytics, advertising, or third-party tracking on the
            app. Most of your data lives in your browser&apos;s IndexedDB; if
            you sign in, the same data syncs to a Supabase project so it&apos;s
            available on other devices. That&apos;s the whole picture - the
            sections below spell it out.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            2. What we store
          </h2>
          <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong>Locally on your device (always):&nbsp;</strong> profile,
              daily meal logs, weight history, custom foods, meal templates, and
              recipes. Stored in IndexedDB by your browser. Clearing your
              browser&apos;s site data removes everything.
            </li>
            <li>
              <strong>In your Supabase project (only when signed in):</strong>{" "}
              the same data, mirrored row-for-row so you can sync across
              devices. Each table has row-level security, so only you can read
              your own rows. The deployment owner controls the Supabase project;
              the maintainer of the open-source code does not.
            </li>
            <li>
              <strong>
                Cloud exports (only when you click Save to cloud):
              </strong>{" "}
              JSON snapshots stored in a private per-user Supabase Storage
              bucket. You can list, download, and delete them at any time from
              Settings → Your data.
            </li>
            <li>
              <strong>Email address</strong> - used to send sign-in one-time
              codes, optional daily reminders, and an optional weekly recap. You
              can disable engagement emails from Settings → Notifications.
            </li>
            <li>
              <strong>
                Passkey public keys (only when you enroll a passkey):
              </strong>{" "}
              the public half of a WebAuthn credential, plus a friendly name you
              choose (e.g. &quot;MacBook Touch ID&quot;) and a created-at /
              last-used-at timestamp. The private key stays on your device or
              hardware key — we never see it. Stored by Supabase Auth alongside
              your account row; deleted when you remove the passkey from
              Settings → Passkeys.
            </li>
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            3. What we do not collect
          </h2>
          <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-muted-foreground">
            <li>No analytics, telemetry, or usage tracking.</li>
            <li>
              No advertising identifiers, no third-party marketing pixels, no
              fingerprinting.
            </li>
            <li>No social media scripts.</li>
            <li>No cross-site cookies.</li>
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            4. Operational error logs
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            When the app crashes, we capture a stack trace, the page path, the
            app version, and your browser&apos;s user-agent string, so the
            maintainer can fix what broke. Logs are stored in the same Supabase
            project as your other data, in a separate table only the maintainer
            can read. They contain{" "}
            <strong>no email, no user ID, no IP address</strong>; a short random
            token rotates each browser session so consecutive errors from the
            same tab can be correlated during triage but never linked back to
            you or across sessions. Logs are deleted after 90 days.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">5. Cookies</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Maqro uses only <strong>strictly necessary cookies</strong>: when
            you sign in, Supabase sets an HTTP-only session cookie so the server
            can recognize you on the next request. The cookie is deleted when
            you sign out or when the session expires. We do not set any other
            cookies, and we do not need a cookie banner because we do not use
            non-essential cookies.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            6. Third-party services
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            When you use specific features, the app communicates with the
            following third parties. Each is governed by its own terms and
            privacy policy:
          </p>
          <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong>Supabase</strong> (auth + database + storage, when signed
              in) - receives your email address for sign-in OTPs and stores the
              rows above. See{" "}
              <a
                href="https://supabase.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                supabase.com/privacy
              </a>
              .
            </li>
            <li>
              <strong>Open Food Facts</strong> (food search) - receives your
              search queries while you type into the food picker. Search history
              is not associated with your account by us. See{" "}
              <a
                href="https://world.openfoodfacts.org/legal"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                openfoodfacts.org/legal
              </a>
              .
            </li>
            <li>
              <strong>Anthropic&nbsp;</strong> (Claude AI, only when AI features
              are enabled and only when you click Auto-fill or Generate recipe)
              - receives your diet preference, allergies, cuisine choices,
              custom foods, and the current request. The maintainer cannot
              guarantee how third parties handle this data; review the relevant
              provider&apos;s policy. See{" "}
              <a
                href="https://www.anthropic.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                anthropic.com/privacy
              </a>
              .
            </li>
            <li>
              <strong>Resend&nbsp;</strong> (transactional email, when
              engagement emails are enabled) - receives your email address and
              the rendered message body for daily reminders, weekly recaps, and
              welcome messages. See{" "}
              <a
                href="https://resend.com/legal/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                resend.com/legal/privacy-policy
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            7. Account deletion
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Settings → Account includes a <strong>Delete account</strong> button
            that removes your Supabase user record. The cascade in the database
            wipes every synced row. The local IndexedDB data on the device is
            also cleared as part of the same action. You do not need to email
            anyone to have your account removed.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            8. Your rights
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            If you are in the EU/UK, applicable data-protection law (GDPR/UK
            GDPR) gives you the right to access, correct, port, and delete your
            personal data, and to object to or restrict its processing.
            Maqro&apos;s design satisfies most of these directly:
          </p>
          <ul className="ml-5 list-disc space-y-1 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong>Access &amp; portability:</strong> Settings → Your data
              includes export of your full record as JSON.
            </li>
            <li>
              <strong>Correction:</strong> all your data is editable directly in
              the app.
            </li>
            <li>
              <strong>Erasure:</strong> Settings → Account → Delete account, or
              sign out and clear browser data for local-only deletion.
            </li>
            <li>
              <strong>Objection / restriction:</strong> disable AI features and
              engagement emails in Settings to limit what is processed.
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-muted-foreground">
            If a feature is missing for your situation, open an issue on GitHub
            (link below) and we&apos;ll add it.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            9. Children
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Maqro is not directed to children under 16. If you are under 16, do
            not use the app without the involvement of a parent or guardian. We
            do not knowingly collect data from children; if you believe a child
            has created an account, contact the maintainer via the GitHub issue
            tracker and we will remove it.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            10. Changes to this policy
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This policy may be updated. Material changes will be accompanied by
            a bumped &ldquo;Last updated&rdquo; date at the top of this page.
            The full revision history is in the Git log of this repository.
          </p>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            11. Contact
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            For privacy questions or requests, open an issue at{" "}
            <a
              href={`${GITHUB_REPO_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {GITHUB_REPO_URL.replace(/^https?:\/\//, "")}/issues
            </a>
            . Please do not include sensitive personal data in public issues -
            if something needs to be private, say so in the issue and the
            maintainer will reach out.
          </p>
        </section>

        <p className="mt-10 text-xs text-muted-foreground">
          See also:{" "}
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Terms &amp; Conditions
          </Link>
          .
        </p>
      </main>
    </>
  );
}
