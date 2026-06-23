import type { WeeklyRecap } from "@/lib/weekly-recap";

/** Plain-HTML email templates. No React-email or MJML — for the
 *  scale we're at (one-shot daily/weekly cron), template-literal
 *  HTML is the lowest-friction option: no extra deps, no build step,
 *  no surprise styling regressions when an upstream dep changes.
 *
 *  Layout conventions:
 *    - Table-based (the only thing every email client renders
 *      reliably; flexbox in Outlook is a no-go).
 *    - 600 px max width — the de-facto inbox width.
 *    - Inline styles only — `<style>` blocks get stripped by
 *      Gmail's "view in inbox" sanitizer.
 *    - System font stack for legibility without webfont latency.
 *
 *  Each template ships with `subject`, `html`, and a `text`
 *  alternative for plain-text clients. */

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function shell(opts: {
  appUrl: string;
  bodyHtml: string;
  preheader: string;
}): string {
  // The hidden preheader text is what the inbox preview shows next
  // to the subject. It's worth setting deliberately — a good
  // preheader doubles open rate compared to the default
  // "view in browser" cruft most clients show.
  const settingsUrl = `${opts.appUrl}/app?view=settings`;
  // ^ Email links go to /app — root `/` is the marketing landing
  //   page now; deep links into the product all live under /app.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f8f9;font-family:${FONT_STACK};color:#0a0a0c;">
<div style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">
  ${opts.preheader}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f9;">
  <tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e6e9;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px;">
        <a href="${opts.appUrl}" style="color:#0a0a0c;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:-0.01em;">Maqro</a>
      </td></tr>
      <tr><td style="padding:0 24px 24px;">
        ${opts.bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e6e6e9;font-size:12px;color:#6b6b76;line-height:1.5;">
        You're getting this because you opted in to Maqro emails.
        <a href="${settingsUrl}" style="color:#0a0a0c;">Manage email preferences</a>
        in the app's Settings tab.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** "Hey, you haven't logged anything today" reminder. Sent by the
 *  daily cron to opted-in users whose `daily_logs` for today is
 *  empty. Tone: short, action-oriented, no guilt. */
export function dailyReminderEmail(opts: {
  appUrl: string;
  streakDays: number;
}): { subject: string; html: string; text: string } {
  const subject =
    opts.streakDays > 0
      ? `Keep your ${opts.streakDays}-day streak alive`
      : "Quick log before bed?";

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      ${opts.streakDays > 0 ? `${opts.streakDays}-day streak` : "Nothing logged yet today"}
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      ${
        opts.streakDays > 0
          ? `Log a meal in the next few hours and you keep the streak going. It only takes a tap or two — your saved templates, recipes, and recent foods are right there.`
          : `A quick log keeps your weekly recap honest. Even a single meal counts — use a saved template, scan a barcode, or pick from your recent foods.`
      }
    </p>
    <a href="${opts.appUrl}/app?view=plan" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Open the meal planner
    </a>
  `;

  const text = [
    opts.streakDays > 0
      ? `Keep your ${opts.streakDays}-day streak alive.`
      : "Nothing logged yet today.",
    "",
    "A quick log keeps your weekly recap honest.",
    "",
    `Open the meal planner: ${opts.appUrl}/app?view=plan`,
    "",
    `Manage email preferences: ${opts.appUrl}/app?view=settings`,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader:
        opts.streakDays > 0
          ? `Don't break a ${opts.streakDays}-day streak.`
          : "A quick log keeps your weekly recap honest.",
      bodyHtml,
    }),
    text,
  };
}

/** Weekly auto-adapt outcome. `applied` = a small change the cron already
 *  wrote to the user's maintenance (reversible heads-up); `pending` = a larger
 *  change held for a one-tap confirm. Tone: matter-of-fact, reversible, no
 *  alarm. */
export function autoAdaptEmail(opts: {
  appUrl: string;
  kind: "applied" | "pending";
  newTdee: number;
  deltaKcal: number;
}): { subject: string; html: string; text: string } {
  const dir = opts.deltaKcal > 0 ? "higher" : "lower";
  const absDelta = Math.abs(opts.deltaKcal);
  const progressUrl = `${opts.appUrl}/app?view=progress`;

  const subject =
    opts.kind === "applied"
      ? `Your maintenance was adjusted to ${opts.newTdee} kcal`
      : `New maintenance estimate: ${opts.newTdee} kcal — confirm to apply`;

  const headline =
    opts.kind === "applied"
      ? `Maintenance adjusted to ${opts.newTdee} kcal/day`
      : `New maintenance estimate: ${opts.newTdee} kcal/day`;

  const message =
    opts.kind === "applied"
      ? `Your recent intake and weight trend moved your maintenance about ${absDelta} kcal ${dir}. Auto-adapt updated your daily target to match — a small weekly nudge. Your targets already reflect it, and you can change it back anytime under Advanced.`
      : `Your recent logging puts maintenance near ${opts.newTdee} kcal — about ${absDelta} kcal ${dir} than your target uses now. That's a bigger move, so we held it for you to confirm rather than changing it automatically. Apply it in one tap.`;

  const cta =
    opts.kind === "applied" ? "See it in Progress" : "Review and apply";

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      ${headline}
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      ${message}
    </p>
    <a href="${progressUrl}" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      ${cta}
    </a>
  `;

  const text = [
    headline,
    "",
    message,
    "",
    `${cta}: ${progressUrl}`,
    "",
    `Manage email preferences: ${opts.appUrl}/app?view=settings`,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader:
        opts.kind === "applied"
          ? `Maintenance is now ${opts.newTdee} kcal — reversible anytime.`
          : `Maintenance looks like ${opts.newTdee} kcal — confirm to apply.`,
      bodyHtml,
    }),
    text,
  };
}

/** Supplement reminder — "time for your {name}". Sent by the hourly
 *  supplement-reminder cron at the user's scheduled local time. Calm + factual;
 *  the in-app card is where they mark it taken. */
export function supplementReminderEmail(opts: {
  appUrl: string;
  name: string;
  doseLabel?: string;
}): { subject: string; html: string; text: string } {
  const dose =
    opts.doseLabel && opts.doseLabel.trim().length > 0
      ? ` (${opts.doseLabel.trim()})`
      : "";
  const subject = `Time for your ${opts.name}`;
  const url = `${opts.appUrl}/app?view=progress`;

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Time for your ${opts.name}
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      A reminder to take your ${opts.name}${dose}. Mark it as taken in the app to
      keep your micronutrient totals accurate.
    </p>
    <a href="${url}" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Open Maqro
    </a>
  `;

  const text = [
    `Time for your ${opts.name}${dose}.`,
    "",
    "Mark it as taken in the app to keep your micronutrient totals accurate.",
    "",
    `Open Maqro: ${url}`,
    "",
    `Manage reminder preferences: ${opts.appUrl}/app?view=settings`,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `A reminder to take your ${opts.name}.`,
      bodyHtml,
    }),
    text,
  };
}

/** Format a date-only ISO window bound ("2026-05-12") as a human label
 *  ("May 12"). Parsed and formatted in UTC so a date-only string never
 *  shifts a day in the server's local zone. Emails are English-only. */
function formatWindowDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Monday-morning weekly digest. The recap object is the same one
 *  the Progress view renders — emails inherit the same definitions
 *  of "logged day", "adherence", and "weight delta" so the numbers
 *  match what the user sees in-app. */
export function weeklyRecapEmail(opts: {
  appUrl: string;
  recap: WeeklyRecap;
  targetCalories: number;
}): { subject: string; html: string; text: string } {
  const { recap, targetCalories } = opts;
  const adherencePct =
    recap.daysLogged > 0
      ? Math.round((recap.adherenceDays / recap.daysLogged) * 100)
      : 0;
  const weightLine =
    recap.weightDeltaKg !== null
      ? `${recap.weightDeltaKg > 0 ? "+" : ""}${recap.weightDeltaKg.toFixed(1)} kg`
      : "No weigh-in";

  const subject = `Your week: ${recap.daysLogged}/7 logged${
    recap.daysLogged > 0 ? `, ${Math.round(recap.avg.calories)} kcal avg` : ""
  }`;

  // Two-column stat table for the headline numbers. Tables are the
  // only layout primitive that survives every email client; flex
  // tabular numbers via the system mono stack so calories /
  // percentages don't jitter.
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Your week in macros
    </h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3a3a40;">
      ${formatWindowDate(recap.windowStart)} – ${formatWindowDate(recap.windowEnd)}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      ${statRow("Days logged", `${recap.daysLogged} / 7`)}
      ${statRow(
        "On-target days",
        targetCalories === 0
          ? "No target set"
          : `${recap.adherenceDays} (${adherencePct}%)`,
      )}
      ${statRow(
        "Avg per logged day",
        recap.daysLogged > 0
          ? `${Math.round(recap.avg.calories)} kcal`
          : "Nothing logged",
      )}
      ${
        recap.daysLogged > 0
          ? statRow(
              "Avg macros",
              `P${recap.avg.protein.toFixed(0)}g · C${recap.avg.carbs.toFixed(0)}g · F${recap.avg.fat.toFixed(0)}g`,
            )
          : ""
      }
      ${statRow("Weight change", weightLine)}
    </table>

    <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6b6b76;">
      ${
        recap.daysLogged === 0
          ? "Nothing logged this week. A short log on most days produces a much better recap and keeps the AI meal planner anchored to what you actually eat."
          : recap.daysLogged < 4
            ? "Patchy logging makes the averages less reliable. Try for at least 4–5 days this week."
            : "Looking good. The Progress tab has the full charts if you want to dig in."
      }
    </p>

    <a href="${opts.appUrl}/app?view=progress" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Open progress
    </a>
  `;

  const text = [
    `Your week: ${formatWindowDate(recap.windowStart)} – ${formatWindowDate(recap.windowEnd)}`,
    "",
    `Days logged: ${recap.daysLogged} / 7`,
    targetCalories === 0
      ? "On-target days: No target set"
      : `On-target days: ${recap.adherenceDays} (${adherencePct}%)`,
    recap.daysLogged > 0
      ? `Avg per logged day: ${Math.round(recap.avg.calories)} kcal · P${recap.avg.protein.toFixed(0)}g · C${recap.avg.carbs.toFixed(0)}g · F${recap.avg.fat.toFixed(0)}g`
      : "Avg per logged day: Nothing logged",
    `Weight change: ${weightLine}`,
    "",
    `Open progress: ${opts.appUrl}/app?view=progress`,
    "",
    `Manage email preferences: ${opts.appUrl}/app?view=settings`,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `${recap.daysLogged}/7 logged · ${weightLine} this week.`,
      bodyHtml,
    }),
    text,
  };
}

/** Trial-ending nudge sent ~1 day before a Stripe trial converts to
 *  a paid subscription. Transactional email — no opt-in required;
 *  it's about the user's billing state, not marketing. Same legal
 *  bucket as "your card was charged" receipts.
 *
 *  Two CTAs: the primary action is "manage subscription" (so the
 *  user can cancel before the charge if they no longer want it),
 *  and an explicit mention of when the charge hits + how much.
 *  Surprise charges are the #1 reason users dispute — being loud
 *  about the conversion price is the cheap path to avoiding
 *  chargebacks. */
export function trialEndingEmail(opts: {
  appUrl: string;
  /** When the trial converts to a paid subscription. */
  trialEnd: Date;
  /** Display label for the tier ("AI Plus", "Pro") so the email
   *  reads as personalized rather than generic. */
  tierLabel: string;
  /** Amount in the smallest currency unit (cents for USD/EUR). */
  amountCents: number;
  /** ISO currency code ("usd", "eur"). Lowercased per Stripe. */
  currency: string;
  /** Stripe Customer Portal URL — opens straight to the manage-
   *  subscription view so the cancel path is one click. */
  portalUrl: string;
}): { subject: string; html: string; text: string } {
  const formattedAmount = formatMoney(opts.amountCents, opts.currency);
  const trialDateLabel = opts.trialEnd.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const subject = `Your Maqro ${opts.tierLabel} trial ends ${trialDateLabel}`;

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Your trial ends ${trialDateLabel}
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      Your Maqro ${opts.tierLabel} trial is up tomorrow. If you keep
      the subscription, your card will be charged
      <strong>${formattedAmount}</strong> on ${trialDateLabel}, and
      you'll continue with full access — AI meal planning, recipe
      generation, and everything that was unlocked during the trial.
    </p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3a3a40;">
      If Maqro isn't a fit, cancel from the billing portal before
      then and you won't be charged. Your local data stays on your
      device either way.
    </p>
    <a href="${opts.portalUrl}" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Manage subscription
    </a>
    <p style="margin:16px 0 0;font-size:12px;color:#6b6b76;line-height:1.5;">
      This is a one-time transactional notice about your account.
      You'll receive it once per trial regardless of email
      preferences.
    </p>
  `;

  const text = [
    `Your Maqro ${opts.tierLabel} trial ends ${trialDateLabel}.`,
    "",
    `If you keep the subscription, your card will be charged ${formattedAmount} on ${trialDateLabel}.`,
    "",
    "If Maqro isn't a fit, cancel from the billing portal before then:",
    opts.portalUrl,
    "",
    "Your local data stays on your device either way.",
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `Card charged ${formattedAmount} on ${trialDateLabel} unless you cancel.`,
      bodyHtml,
    }),
    text,
  };
}

/** Subscription-active confirmation. Fires once on the
 *  checkout.session.completed webhook when the subscription lands in
 *  `active` or `trialing` state. Transactional: account-state mail,
 *  same legal bucket as a receipt.
 *
 *  The "what you get" body deliberately avoids feature-listing every
 *  capability — that's marketing's job. We say "you're in" and link
 *  to the app. The receipt-style amount + interval line is the
 *  legally useful part. */
export function subscriptionConfirmedEmail(opts: {
  appUrl: string;
  tierLabel: string;
  amountCents: number;
  currency: string;
  /** "month", "year" — whatever Stripe sent in the recurring config. */
  intervalLabel: string;
  /** Deep link into the in-app billing settings (manages payment
   *  method, cancels, sees invoices). */
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const formattedAmount = formatMoney(opts.amountCents, opts.currency);
  const subject = `You're on Maqro ${opts.tierLabel}`;

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      You're on ${opts.tierLabel}
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      Thanks for subscribing. Your card will be charged
      <strong>${formattedAmount} / ${opts.intervalLabel}</strong> on the
      same day each ${opts.intervalLabel}. Manage the subscription,
      change payment method, or grab past invoices any time from
      Settings → Subscription.
    </p>
    <a href="${opts.appUrl}/app?view=plan" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Open Maqro
    </a>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b6b76;">
      <a href="${opts.settingsUrl}" style="color:#0a0a0c;">Manage subscription</a>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#6b6b76;line-height:1.5;">
      This is a one-time transactional notice about your account.
      You'll receive it whenever a subscription starts, regardless of
      email preferences.
    </p>
  `;

  const text = [
    `You're on Maqro ${opts.tierLabel}.`,
    "",
    `You'll be charged ${formattedAmount} / ${opts.intervalLabel}.`,
    "",
    `Open Maqro: ${opts.appUrl}/app?view=plan`,
    `Manage subscription: ${opts.settingsUrl}`,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `${formattedAmount} / ${opts.intervalLabel}. Manage any time from Settings.`,
      bodyHtml,
    }),
    text,
  };
}

/** Cancellation confirmation. Fires once when a subscription
 *  transitions to `cancel_at_period_end: true` — the user clicked
 *  "Cancel" in the in-app portal. The wording is deliberate: it's
 *  past-tense ("we've cancelled") so the user knows the action took,
 *  AND it's clear they keep access through the end of the period
 *  (Stripe's default — we don't immediately yank entitlement).
 *
 *  Also surfaces the resume path: if they change their mind before
 *  `accessUntil`, the in-app Settings → Subscription has a "Resume"
 *  button. Reducing support tickets of the form "I cancelled by
 *  mistake, am I locked out?" */
export function subscriptionCancelledEmail(opts: {
  appUrl: string;
  tierLabel: string;
  /** When entitlement actually ends. Stripe's `current_period_end`
   *  on the subscription, rendered in the user's local format. */
  accessUntil: Date;
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const dateLabel = opts.accessUntil.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const subject = `Your Maqro ${opts.tierLabel} subscription is cancelled`;

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Cancellation confirmed
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      We've cancelled your Maqro ${opts.tierLabel} subscription.
      You'll keep full access through <strong>${dateLabel}</strong>;
      after that, your account drops back to the free tier. Your
      logged data, recipes, and meal plans stay put — you'll just
      lose the AI features and any paid-only gates.
    </p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3a3a40;">
      Changed your mind? You can resume the subscription before
      ${dateLabel} from Settings → Subscription and nothing breaks.
    </p>
    <a href="${opts.settingsUrl}" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Manage subscription
    </a>
    <p style="margin:16px 0 0;font-size:12px;color:#6b6b76;line-height:1.5;">
      This is a one-time transactional notice about your account.
    </p>
  `;

  const text = [
    `Your Maqro ${opts.tierLabel} subscription is cancelled.`,
    "",
    `You keep full access through ${dateLabel}.`,
    "",
    `Changed your mind? Resume any time before ${dateLabel}:`,
    opts.settingsUrl,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `Cancelled. Access continues through ${dateLabel}.`,
      bodyHtml,
    }),
    text,
  };
}

/** Final dunning email — sent after Stripe has exhausted its smart-
 *  retry schedule for a failed invoice and given up
 *  (`next_payment_attempt: null`). At this point the subscription is
 *  effectively in payment limbo: status is `past_due` or `unpaid`,
 *  and unless the user updates their card the subscription will move
 *  to `canceled` shortly.
 *
 *  Tone: pragmatic, not alarming. Card declines are usually a bank's
 *  fraud heuristic or an expired card, not actual fraud. The CTA is
 *  the in-app billing portal where the user can swap payment
 *  methods and trigger a retry from Stripe. */
export function paymentFailedFinalEmail(opts: {
  appUrl: string;
  tierLabel: string;
  /** The amount Stripe couldn't charge. Helps the user recognize
   *  which subscription this is about (someone with both a personal
   *  and a team plan, for example). */
  amountCents: number;
  currency: string;
  settingsUrl: string;
}): { subject: string; html: string; text: string } {
  const formattedAmount = formatMoney(opts.amountCents, opts.currency);
  const subject = `Action needed: Maqro ${opts.tierLabel} payment failed`;

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      We couldn't process your payment
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      We tried a few times to charge <strong>${formattedAmount}</strong>
      for your Maqro ${opts.tierLabel} subscription and the card kept
      declining. Most of the time this is an expired card or your bank
      flagging the charge for review — nothing on our end.
    </p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3a3a40;">
      Open Settings → Subscription and update your payment method to
      restore access. If we still can't charge in the next few days,
      the subscription will be cancelled automatically and you'll drop
      to the free tier.
    </p>
    <a href="${opts.settingsUrl}" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Update payment method
    </a>
    <p style="margin:16px 0 0;font-size:12px;color:#6b6b76;line-height:1.5;">
      This is a one-time transactional notice about your account.
    </p>
  `;

  const text = [
    `Your Maqro ${opts.tierLabel} payment failed.`,
    "",
    `We couldn't charge ${formattedAmount}. Card likely expired or flagged.`,
    "",
    `Update your payment method to restore access:`,
    opts.settingsUrl,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `Update your payment method to keep Maqro ${opts.tierLabel}.`,
      bodyHtml,
    }),
    text,
  };
}

/** Account-deletion confirmation. Fires from the /api/delete-account
 *  route after the auth.users row is gone. Plain confirmation — no
 *  PII, no recovery link (there's nothing left to recover), no
 *  "we'd love you back" guilt mail.
 *
 *  Why send at all: regulatory + trust. Confirming the destructive
 *  action lets the user know it actually completed (vs. a silent
 *  failure mode where the button "worked" but didn't), and it gives
 *  them a paper trail if they later realize they'd intended to keep
 *  the account. */
export function accountDeletedEmail(opts: { appUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "Your Maqro account is deleted";

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Account deleted
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      Your Maqro account is gone. Every logged meal, recipe, plan,
      and setting is removed from our servers. Any active subscription
      has been cancelled — no further charges will hit your card.
    </p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3a3a40;">
      You're free to sign up again any time with the same address;
      we don't carry anything over from the deleted account.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b76;">
      This is a one-time confirmation. You won't receive further mail
      from us at this address unless you create a new account.
    </p>
  `;

  const text = [
    "Your Maqro account is deleted.",
    "",
    "Every logged meal, recipe, plan, and setting is removed from our servers.",
    "Any active subscription has been cancelled — no further charges.",
    "",
    `Free to sign up again at ${opts.appUrl} any time.`,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: "Your data is removed. Any subscription has been cancelled.",
      bodyHtml,
    }),
    text,
  };
}

/** Internal-facing support-request email. Sent to the support
 *  inbox when a user submits the contact form. The body is the
 *  user's verbatim message (HTML-escaped) plus an envelope of
 *  metadata — auth state, account email, user agent — so the
 *  responder doesn't have to play detective figuring out who's
 *  on the other end.
 *
 *  Reply-To is set by the API route to the user's email when
 *  available, so a reply from the support inbox lands in the
 *  user's inbox without manual address-copying. */
export function supportRequestEmail(opts: {
  appUrl: string;
  subject: string;
  body: string;
  /** Email the user typed (anonymous) or the auth email (logged-in). */
  fromEmail: string;
  /** "logged-in" / "anonymous" — orients the responder before they
   *  look at the rest of the envelope. */
  authState: "logged-in" | "anonymous";
  /** User-Agent header — non-PII, helps reproduce browser-specific
   *  bug reports. Truncated to 200 chars defensively. */
  userAgent: string | null;
  /** ISO timestamp of when the request was received. */
  receivedAt: string;
}): { subject: string; html: string; text: string } {
  const subject = `[Maqro support] ${opts.subject.slice(0, 120)}`;
  const safeBody = escapeHtml(opts.body);
  const safeSubject = escapeHtml(opts.subject);
  const safeEmail = escapeHtml(opts.fromEmail);
  const safeUa = opts.userAgent
    ? escapeHtml(opts.userAgent.slice(0, 200))
    : "—";

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;letter-spacing:-0.02em;">
      ${safeSubject}
    </h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:13px;">
      ${envelopeRow("From", safeEmail)}
      ${envelopeRow("Account", opts.authState)}
      ${envelopeRow("Received", opts.receivedAt)}
      ${envelopeRow("User-Agent", safeUa)}
    </table>
    <div style="margin:0 0 8px;padding:12px 16px;background:#f8f8f9;border:1px solid #e6e6e9;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;color:#0a0a0c;">
${safeBody}
    </div>
  `;

  const text = [
    `Subject: ${opts.subject}`,
    `From: ${opts.fromEmail} (${opts.authState})`,
    `Received: ${opts.receivedAt}`,
    `User-Agent: ${opts.userAgent ?? "—"}`,
    "",
    "Body:",
    opts.body,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `${opts.fromEmail} (${opts.authState})`,
      bodyHtml,
    }),
    text,
  };
}

/** User-facing receipt: "we got your message, we'll get back to
 *  you". Sets the expectation that a real human reads it; no
 *  ticket numbers, no support portal — just a confirmation that
 *  the form didn't drop into a void. */
export function supportRequestConfirmationEmail(opts: {
  appUrl: string;
  subject: string;
}): { subject: string; html: string; text: string } {
  const subject = `We got your message: ${opts.subject.slice(0, 80)}`;
  const safeSubject = escapeHtml(opts.subject);

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Thanks — we got your message
    </h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3a3a40;">
      We'll reply within a couple of business days — usually faster.
      Reference subject: <strong>${safeSubject}</strong>
    </p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3a3a40;">
      If anything's urgent (billing dispute, locked out of an
      account), reply to this email with the word "urgent" in the
      subject and we'll prioritize.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b76;">
      Maqro is a small team; replies come from a real person, not a
      ticketing bot.
    </p>
  `;

  const text = [
    "Thanks — we got your message.",
    "",
    `Subject: ${opts.subject}`,
    "",
    "We'll reply within a couple of business days. If something is",
    "urgent, reply with 'urgent' in the subject.",
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: "We'll reply within a couple of business days.",
      bodyHtml,
    }),
    text,
  };
}

function envelopeRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:4px 12px 4px 0;color:#6b6b76;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;white-space:nowrap;">${label}</td>
    <td style="padding:4px 0;color:#0a0a0c;font-size:13px;font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace;word-break:break-all;">${value}</td>
  </tr>`;
}

/** Minimal HTML-escape for user-supplied input. We don't try to
 *  preserve user-written HTML — the body is rendered in a preformatted
 *  block, and the only risk-bearing strings (subject, email, UA) are
 *  escaped at the boundary. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Stripe returns amounts in the smallest currency unit (cents).
 *  Convert to a display string using `Intl.NumberFormat` — handles
 *  symbol placement, decimals, and locale-correct grouping. Falls
 *  back to a "12.34 USD" rendering for unknown currencies. */
function formatMoney(amountCents: number, currency: string): string {
  const major = amountCents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function statRow(label: string, value: string): string {
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #e6e6e9;font-size:13px;color:#6b6b76;">${label}</td>
<td style="padding:8px 0;border-bottom:1px solid #e6e6e9;font-size:14px;color:#0a0a0c;font-family:ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace;text-align:right;">${value}</td></tr>`;
}

/** Welcome email sent exactly once per user, the first time they
 *  opt in to any transactional email. The `/api/notifications/welcome`
 *  route is idempotent via `welcome_sent_at` so the client can
 *  fire it on every toggle-on without worry.
 *
 *  Body adapts to which flag(s) they enabled so the email matches
 *  what they actually subscribed to — sending a generic "you'll
 *  hear from us!" when they only opted into the weekly recap reads
 *  as bait-and-switch. */
export function welcomeEmail(opts: {
  appUrl: string;
  dailyReminder: boolean;
  weeklyRecap: boolean;
}): { subject: string; html: string; text: string } {
  const subject = "You're subscribed to Maqro emails";

  // Build a list of what they'll actually receive so the email
  // doesn't over-promise. Both flags false would normally mean the
  // welcome shouldn't have fired — but if it somehow does, we say
  // nothing about cadence rather than lying.
  const items: string[] = [];
  if (opts.dailyReminder) {
    items.push(
      "<strong>Daily reminder</strong> — a short nudge if you haven't logged a meal by evening. Skipped silently once you log.",
    );
  }
  if (opts.weeklyRecap) {
    items.push(
      "<strong>Weekly recap</strong> — Monday-morning summary of the previous 7 days. Skipped if you logged nothing that week.",
    );
  }
  const listHtml =
    items.length > 0
      ? `<ul style="margin:0 0 16px;padding:0 0 0 20px;font-size:14px;line-height:1.6;color:#3a3a40;">
${items.map((it) => `<li style="margin-bottom:8px;">${it}</li>`).join("\n")}
</ul>`
      : "";

  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      You're in.
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      Thanks for opting in to Maqro emails. Here's what to expect:
    </p>
    ${listHtml}
    <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6b6b76;">
      Nothing else. No newsletters, no product announcements, no
      "we miss you" guilt-mail. Two opt-ins, two emails — that's it.
      Manage them any time in Settings &rarr; Email notifications.
    </p>
    <a href="${opts.appUrl}/app?view=plan" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:500;">
      Open the meal planner
    </a>
  `;

  const textItems: string[] = [];
  if (opts.dailyReminder) {
    textItems.push("- Daily reminder if you haven't logged by evening");
  }
  if (opts.weeklyRecap) {
    textItems.push("- Weekly recap on Monday morning");
  }
  const text = [
    "You're in. Thanks for opting in to Maqro emails.",
    "",
    "Here's what to expect:",
    ...textItems,
    "",
    "Nothing else. No newsletters, no product announcements.",
    "",
    `Open the meal planner: ${opts.appUrl}/app?view=plan`,
    "",
    `Manage email preferences: ${opts.appUrl}/app?view=settings`,
  ].join("\n");

  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader:
        items.length > 1
          ? "Two opt-ins, two emails. No newsletters, no other surprises."
          : "Confirmed. No newsletters, no other surprises.",
      bodyHtml,
    }),
    text,
  };
}

/** Backup-contact verification OTP. Sent to a candidate backup
 *  email address after the user submits it from Settings →
 *  Backup email. The user reads the 6-digit code, types it back
 *  into Settings, and the backup is promoted from "pending" to
 *  "verified".
 *
 *  Tone: short, mechanical, and honest about why it arrived in
 *  this inbox (the recipient might not be the primary user — it's
 *  meant for a "lost access to my email" recovery path, so the
 *  recipient mailbox could belong to a partner / family member /
 *  the user's other address). */
export function backupEmailVerificationEmail(opts: {
  appUrl: string;
  code: string;
  primaryEmailMasked: string;
}): { subject: string; html: string; text: string } {
  const subject = `Maqro backup-email code: ${opts.code}`;
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Confirm this as a backup email
    </h1>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3a3a40;">
      Someone signed in to Maqro as
      <strong>${opts.primaryEmailMasked}</strong> and asked us to use this
      address as a backup. If that&rsquo;s you, paste the code below into
      Settings &rarr; Backup email to confirm.
    </p>
    <p style="margin:0 0 20px;font-size:32px;font-weight:600;letter-spacing:0.12em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0a0a0c;">
      ${opts.code}
    </p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b6b76;">
      The code expires in 10 minutes. If you weren&rsquo;t expecting this,
      ignore the email &mdash; nothing changes on your end and the request
      drops when the code expires.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b76;">
      Maqro never shares your address. The backup is used only to deliver
      a sign-in link if you ever lose access to your primary inbox.
    </p>
  `;
  const text = [
    `Maqro backup-email code: ${opts.code}`,
    "",
    `Someone signed in to Maqro as ${opts.primaryEmailMasked} and asked us to`,
    "use this address as a backup. Paste the code into Settings → Backup email.",
    "",
    "Code expires in 10 minutes. If this wasn't you, ignore the email.",
  ].join("\n");
  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `Code ${opts.code} — confirm a Maqro backup email.`,
      bodyHtml,
    }),
    text,
  };
}

/** Account-recovery magic-link. Sent to the user's *backup* email
 *  after they request recovery from /login/recovery. The link is a
 *  one-shot Supabase magic-link that signs them into their PRIMARY
 *  account.
 *
 *  Includes the masked primary email so the recipient understands
 *  which account they're about to access (relevant when the backup
 *  inbox is shared with a partner who may also have a Maqro
 *  account). */
export function accountRecoveryEmail(opts: {
  appUrl: string;
  magicLink: string;
  primaryEmailMasked: string;
}): { subject: string; html: string; text: string } {
  const subject = "Sign in to Maqro (recovery link)";
  const bodyHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">
      Recovery sign-in
    </h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3a3a40;">
      This is a one-shot recovery link for the Maqro account at
      <strong>${opts.primaryEmailMasked}</strong>. Open it to get back in. If
      you still have your authenticator app, you&rsquo;ll enter a code; if
      you&rsquo;ve lost it, you can remove two-step verification from the
      recovery page and set it up again.
    </p>
    <p style="margin:0 0 20px;">
      <a href="${opts.magicLink}" style="display:inline-block;background:#0a0a0c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500;">
        Continue to recovery
      </a>
    </p>
    <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b6b76;">
      The link works once and expires in an hour. If you didn&rsquo;t
      request recovery, ignore the email &mdash; the link can only be
      delivered to this backup address you previously confirmed.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b76;">
      If you&rsquo;ve also lost access to your primary email, you can update it
      in Settings once you&rsquo;re back in.
    </p>
  `;
  const text = [
    "Account recovery for Maqro",
    "",
    `Account: ${opts.primaryEmailMasked}`,
    "",
    "Open this link to get back in (works once, expires in an hour). If you",
    "still have your authenticator, you'll enter a code; if you lost it, you",
    "can remove two-step verification and set it up again:",
    opts.magicLink,
    "",
    "If you didn't request recovery, ignore this email.",
  ].join("\n");
  return {
    subject,
    html: shell({
      appUrl: opts.appUrl,
      preheader: `One-shot sign-in link for ${opts.primaryEmailMasked}.`,
      bodyHtml,
    }),
    text,
  };
}
