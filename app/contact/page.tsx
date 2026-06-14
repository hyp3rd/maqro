"use client";

import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/auth/TurnstileWidget";
import { Footer } from "@/components/shell/Footer";
import { PageTopBar } from "@/components/shell/PageTopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUG_REPORT_URL, FEATURE_REQUEST_URL } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  Bug,
  CreditCard,
  ExternalLink,
  HelpCircle,
  Lightbulb,
  type LucideIcon,
  MessageSquare,
  ShieldQuestion,
  UserCog,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

/** Public contact form, now category-first.
 *
 *  Beta testers landed on a blank form and routinely picked the
 *  wrong channel - bug reports without repro steps, feature
 *  requests we could've routed to a templated GitHub issue, billing
 *  questions hidden under "general question". A category picker up
 *  front (a) puts the right channel in front of the right
 *  question (Bug → GitHub template, Feature → GitHub template),
 *  (b) pre-fills a useful subject so the routed email is easy to
 *  triage, (c) keeps a single form for the cases where the user
 *  doesn't want to leave the page.
 *
 *  Categories that should leave the form behind get a clear
 *  call-out CTA pointing to the better-fitting channel. The form
 *  is still rendered underneath so a user who really wants to
 *  stay can keep typing. */

type CategoryKey =
  | "account"
  | "billing"
  | "bug"
  | "feature"
  | "security"
  | "general";

type Category = {
  key: CategoryKey;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Subject prefix written to the form when the category is
   *  chosen. Helps the operator's inbox triage. */
  subjectPrefix: string;
  /** Optional "you should probably use this instead" CTA. The form
   *  is still available below - this is a suggestion, not a
   *  redirect. */
  betterChannel?: {
    label: string;
    href: string;
    rationale: string;
    external?: boolean;
  };
};

const CATEGORIES: Category[] = [
  {
    key: "account",
    label: "Account / sign-in",
    description:
      "Can't sign in, lost email, account locked, two-step verification issues.",
    icon: UserCog,
    subjectPrefix: "[Account]",
  },
  {
    key: "billing",
    label: "Billing / subscription",
    description: "Refund, plan change, invoice, charge you don't recognize.",
    icon: CreditCard,
    subjectPrefix: "[Billing]",
  },
  {
    key: "bug",
    label: "Report a bug",
    description: "Something's broken or behaving unexpectedly.",
    icon: Bug,
    subjectPrefix: "[Bug]",
    betterChannel: {
      label: "Open a GitHub bug report",
      href: BUG_REPORT_URL,
      rationale:
        "The GitHub template asks for repro steps + version + browser up front, which gets a faster fix than a free-text email.",
      external: true,
    },
  },
  {
    key: "feature",
    label: "Suggest a feature",
    description: "An idea, improvement, or missing capability.",
    icon: Lightbulb,
    subjectPrefix: "[Feature]",
    betterChannel: {
      label: "Open a GitHub feature request",
      href: FEATURE_REQUEST_URL,
      rationale:
        "Feature requests in the public tracker let other users +1 and add context, which helps prioritise against the rest of the backlog.",
      external: true,
    },
  },
  {
    key: "security",
    label: "Security report",
    description: "Vulnerability, data-exposure concern, dependency risk.",
    icon: ShieldQuestion,
    subjectPrefix: "[Security]",
    betterChannel: {
      label: "Email security@maqro.app",
      href: "mailto:security@maqro.app",
      rationale:
        "Security reports route to a private inbox so the disclosure stays out of the public tracker until it's patched.",
    },
  },
  {
    key: "general",
    label: "Something else",
    description: "Question, feedback, partnership, or anything else.",
    icon: HelpCircle,
    subjectPrefix: "[General]",
  },
];

export default function ContactPage() {
  // Only the back-link is translated for now. The form body (label,
  // description, category metadata, submit, etc.) stays in English
  // because the support inbox replying to messages is also English-
  // first; localising one side without the other tends to read as
  // "shouting in two languages." When we add a multilingual
  // support rotation, the `contactPage` namespace will grow to
  // cover the form labels.
  const tBar = useTranslations("pageTopBar");
  const [category, setCategory] = useState<CategoryKey | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useTurnstile();

  const selected = CATEGORIES.find((c) => c.key === category) ?? null;
  const messageLen = message.length;
  const messageOk = messageLen >= 10 && messageLen <= 5000;
  const subjectOk = subject.trim().length > 0 && subject.trim().length <= 200;

  function pickCategory(next: CategoryKey) {
    setCategory(next);
    const cat = CATEGORIES.find((c) => c.key === next);
    if (!cat) return;
    // Seed the subject with the category prefix the first time the
    // user picks the category (or any time they switch categories
    // before typing their own). Don't clobber a subject the user
    // has already started writing.
    if (!subject || (subject.startsWith("[") && subject.endsWith("] "))) {
      setSubject(`${cat.subjectPrefix} `);
    } else if (/^\[[^\]]+\]\s/.test(subject)) {
      // They typed after a previous category prefix - swap the
      // prefix in place, preserving their text.
      setSubject(subject.replace(/^\[[^\]]+\]\s*/, `${cat.subjectPrefix} `));
    }
  }

  async function submit() {
    setError(null);
    if (!subjectOk) {
      setError("Subject is required and must be 1–200 characters.");
      return;
    }
    if (!messageOk) {
      setError("Message must be 10–5000 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body: message.trim(),
          email: email.trim() || undefined,
          turnstileToken: turnstile.token ?? undefined,
        }),
      });
      if (res.status === 429) {
        setError("You've sent a lot of messages already. Try again later.");
        turnstile.reset();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        turnstile.reset();
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Try again.");
      turnstile.reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PageTopBar label={tBar("backToApp")} />
      <main className="flex flex-1 justify-center px-safe-or-6 py-8">
        <div className="w-full max-w-xl space-y-6">
          <header className="space-y-1">
            <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Contact support
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick what you&apos;re writing about - we&apos;ll either point you
              at the best channel or get your message into the right inbox. A
              real person reads every one; replies usually arrive within a
              couple of business days.
            </p>
          </header>

          {submitted ? (
            <div
              role="status"
              className="space-y-3 rounded-md border border-border/60 bg-card px-4 py-3 text-sm"
            >
              <p className="font-medium">Message sent.</p>
              <p className="text-muted-foreground">
                We&apos;ve emailed you a confirmation. If you don&apos;t see it
                in a few minutes, check your spam folder - and if it&apos;s
                still missing, the address you gave us might have a typo. You
                can resend from this page anytime.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/"
                  className="inline-block text-xs text-foreground underline underline-offset-2"
                >
                  Back to home
                </Link>
                <Link
                  href="/app"
                  className="inline-block text-xs text-foreground underline underline-offset-2"
                >
                  Open the app
                </Link>
              </div>
            </div>
          ) : (
            <>
              <CategoryPicker
                selected={category}
                onPick={pickCategory}
              />

              {selected?.betterChannel && (
                <BetterChannelNotice
                  channel={selected.betterChannel}
                  categoryLabel={selected.label}
                />
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label
                    htmlFor="support-email"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Your email{" "}
                    <span className="text-[10px] uppercase tracking-wide opacity-70">
                      (signed-in users: leave blank)
                    </span>
                  </Label>
                  <Input
                    id="support-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="support-subject"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Subject
                  </Label>
                  <Input
                    id="support-subject"
                    type="text"
                    required
                    maxLength={200}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={
                      selected
                        ? `${selected.subjectPrefix} A short summary`
                        : "A short summary"
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="support-body"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Message
                  </Label>
                  <Textarea
                    id="support-body"
                    required
                    rows={7}
                    maxLength={5000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={messagePlaceholder(selected?.key)}
                    disabled={busy}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {messageLen} / 5000 characters
                  </p>
                </div>
                {error && (
                  <p
                    role="alert"
                    className="text-xs text-red-600"
                  >
                    {error}
                  </p>
                )}
                <TurnstileWidget {...turnstile.widgetProps} />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    busy || !subjectOk || !messageOk || !turnstile.ready
                  }
                >
                  {busy ? "Sending…" : "Send message"}
                </Button>
              </form>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function CategoryPicker({
  selected,
  onPick,
}: {
  selected: CategoryKey | null;
  onPick: (next: CategoryKey) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">
        What can we help with?
      </legend>
      <div
        role="radiogroup"
        aria-label="Contact category"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = selected === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPick(cat.key)}
              className={cn(
                "flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-foreground/40 ring-1 ring-foreground/20"
                  : "border-border/60 hover:bg-accent/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  active
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground",
                )}
                aria-hidden
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{cat.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {cat.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function BetterChannelNotice({
  channel,
  categoryLabel,
}: {
  channel: NonNullable<Category["betterChannel"]>;
  categoryLabel: string;
}) {
  const linkClassName =
    "inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-500/20 dark:text-amber-200";
  return (
    <div
      role="region"
      aria-label={`Better channel for ${categoryLabel}`}
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs"
    >
      <p className="font-medium text-amber-900 dark:text-amber-200">
        There&apos;s a better channel for this.
      </p>
      <p className="mt-1 leading-relaxed text-amber-900/85 dark:text-amber-200/85">
        {channel.rationale}
      </p>
      <div className="mt-2.5">
        {channel.external ? (
          <a
            href={channel.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            {channel.label}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <a
            href={channel.href}
            className={linkClassName}
          >
            {channel.label}
          </a>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Or keep typing below - the contact form still works for this; we just
        get to a fix faster with the templated path.
      </p>
    </div>
  );
}

/** Per-category placeholder that gives the user a head-start on
 *  what we'd love to see in the message body. Keeps the operator's
 *  triage fast without being prescriptive. */
function messagePlaceholder(key: CategoryKey | undefined): string {
  switch (key) {
    case "account":
      return "What happened when you tried to sign in? Which email address are you using?";
    case "billing":
      return "Which plan are you on? Mention the last 4 digits of your card or the Stripe receipt number if you have it.";
    case "bug":
      return "What did you expect? What happened instead? Steps to reproduce + your browser and app version, please.";
    case "feature":
      return "What problem are you trying to solve? Describe the situation, not the solution - we can usually find a better path together.";
    case "security":
      return "Reach security@maqro.app directly for vulnerabilities. If you're using this form anyway, please don't include exploitation details - just the surface and how to contact you.";
    case "general":
      return "Tell us what's on your mind.";
    default:
      return "What's going on?";
  }
}
