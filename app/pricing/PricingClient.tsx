"use client";

import {
  type Cycle,
  effectiveMonthly,
  FEATURE_MATRIX,
  MATRIX_VALUE_KEYS,
  type PlanData,
  PLANS,
  yearlyDiscountPct,
  yearlySavingsEur,
} from "@/lib/billing/plans";
import { useState } from "react";
import { Check, MessageSquare, Minus, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

/** Client wrapper for the pricing page. Only the
 *  monthly/yearly toggle needs to be interactive; the matrix +
 *  cards rerender from the same module-level data. Splitting this
 *  out keeps the route file's metadata + chrome server-rendered
 *  (good for SEO + faster first paint) and only ships this small
 *  surface to the browser.
 *
 *  All user-facing text resolves through next-intl. The plan data
 *  in [lib/billing/plans.ts](../../lib/billing/plans.ts) carries
 *  translation keys (not literal strings) so adding a locale is a
 *  pure JSON change. */
export function PricingClient() {
  const t = useTranslations("pricingPage");
  const [cycle, setCycle] = useState<Cycle>("monthly");

  return (
    <>
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("header.eyebrow")}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("header.title")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("header.subtitle")}
        </p>
      </header>

      <div className="mt-8 flex justify-center">
        <CycleToggle
          cycle={cycle}
          onChange={setCycle}
        />
      </div>

      <section className="mt-10 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            cycle={cycle}
          />
        ))}
      </section>

      <section className="mt-16">
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          {t("matrix.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("matrix.subtitle")}
        </p>
        <FeatureMatrixTable />
      </section>

      <section className="mt-16">
        <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
          {t("faqsTitle")}
        </h2>
        <PricingFaq />
      </section>

      <section className="mt-16 rounded-xl border border-border/60 bg-muted/20 px-5 py-6 text-center sm:px-8 sm:py-8">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {t("stillUnsure.title")}
        </h2>
        <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted-foreground">
          {t("stillUnsure.body")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("stillUnsure.openApp")}
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {t("stillUnsure.askQuestion")}
          </Link>
        </div>
      </section>
    </>
  );
}

function CycleToggle({
  cycle,
  onChange,
}: {
  cycle: Cycle;
  onChange: (next: Cycle) => void;
}) {
  const t = useTranslations("pricingPage.cycle");
  return (
    <div
      role="tablist"
      aria-label={t("ariaLabel")}
      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background p-1 text-xs"
    >
      <ToggleButton
        active={cycle === "monthly"}
        onClick={() => onChange("monthly")}
        label={t("monthly")}
      />
      <ToggleButton
        active={cycle === "yearly"}
        onClick={() => onChange("yearly")}
        label={t("yearly")}
        badge={t("yearlyBadge")}
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {label}
      {badge && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
            active
              ? "bg-background/20 text-background"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function PlanCard({ plan, cycle }: { plan: PlanData; cycle: Cycle }) {
  // Per-plan namespace so the keys read as
  // `pricingPage.plans.<tier>.<key>` without endless prefix
  // duplication in the JSX below.
  const tPlan = useTranslations(`pricingPage.plans.${plan.tier}`);
  const tCard = useTranslations("pricingPage.card");
  const monthly = effectiveMonthly(plan, cycle);
  const discount = yearlyDiscountPct(plan);
  const savings = yearlySavingsEur(plan);
  const isFree = plan.monthlyEur === 0;
  const href = isFree ? "/app" : `/app?upgrade=${plan.tier}`;

  return (
    <article
      className={`relative flex flex-col rounded-xl border bg-card p-6 ${
        plan.recommended
          ? "border-foreground/40 shadow-lg shadow-foreground/[0.04]"
          : "border-border/60"
      }`}
    >
      {plan.recommended && (
        <span className="absolute -top-2.5 left-6 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
          {tCard("recommended")}
        </span>
      )}
      <h3 className="font-display text-lg font-semibold tracking-tight">
        {tPlan(plan.nameKey)}
      </h3>
      <p className="mt-1 min-h-[2.5rem] text-xs text-muted-foreground">
        {tPlan(plan.taglineKey)}
      </p>
      <p className="mt-5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="font-display text-4xl font-semibold tracking-tight">
          €{formatPrice(monthly)}
        </span>
        <span className="text-xs text-muted-foreground">
          / {isFree ? tCard("forever") : tCard("month")}
        </span>
        {!isFree && savings > 0 && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            {tCard("saveBadge", { amount: savings })}
          </span>
        )}
      </p>
      <p className="mt-1 min-h-[1.25rem] text-[11px] text-muted-foreground">
        {!isFree && cycle === "yearly" && discount > 0
          ? tCard("yearlyBilledNote", { yearly: plan.yearlyEur, discount })
          : !isFree && cycle === "monthly"
            ? tCard("monthlySaveNote", { yearly: plan.yearlyEur, discount })
            : ""}
      </p>
      <ul className="mt-6 flex-1 space-y-2 text-sm">
        {plan.featureKeys.map((k) => (
          <li
            key={k}
            className="flex items-start gap-2"
          >
            <Check
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/80"
            />
            <span>{tPlan(`features.${k}`)}</span>
          </li>
        ))}
      </ul>
      <Link
        href={href}
        className={`mt-6 inline-flex items-center justify-center gap-1 rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 ${
          plan.recommended
            ? "bg-foreground text-background"
            : "border border-border bg-background text-foreground"
        }`}
      >
        {tPlan(plan.ctaKey)}
      </Link>
    </article>
  );
}

function formatPrice(eur: number): string {
  return Number.isInteger(eur) ? String(eur) : eur.toFixed(1);
}

function FeatureMatrixTable() {
  const t = useTranslations("pricingPage.matrix");
  // Group rows by section so we can render a sub-header above each
  // group without duplicating the section field on every row.
  const sections = new Map<string, typeof FEATURE_MATRIX>();
  for (const row of FEATURE_MATRIX) {
    const bucket = sections.get(row.section) ?? [];
    bucket.push(row);
    sections.set(row.section, bucket);
  }

  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border/60 bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">
                {t("headers.feature")}
              </th>
              <th className="px-4 py-2 text-center font-medium">
                {t("headers.free")}
              </th>
              <th className="px-4 py-2 text-center font-medium">
                {t("headers.plus")}
              </th>
              <th className="px-4 py-2 text-center font-medium">
                {t("headers.pro")}
              </th>
            </tr>
          </thead>
          {Array.from(sections.entries()).map(([section, rows]) => (
            <tbody
              key={section}
              className="divide-y divide-border/60"
            >
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={4}
                  className="bg-muted/20 px-4 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {t(`sections.${section}`)}
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row.rowKey}>
                  <td className="px-4 py-3 align-top">
                    <p className="text-sm">{t(`rows.${row.rowKey}.label`)}</p>
                    {row.hasDetail && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t(`rows.${row.rowKey}.detail`)}
                      </p>
                    )}
                  </td>
                  <Cell value={row.free} />
                  <Cell value={row.plus} />
                  <Cell value={row.pro} />
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function Cell({ value }: { value: boolean | string }) {
  const t = useTranslations("pricingPage.matrix");
  if (value === true) {
    return (
      <td className="px-4 py-3 text-center align-top">
        <Check
          aria-label={t("cellIncluded")}
          className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400"
        />
      </td>
    );
  }
  if (value === false) {
    return (
      <td className="px-4 py-3 text-center align-top">
        <Minus
          aria-label={t("cellNotIncluded")}
          className="mx-auto h-4 w-4 text-muted-foreground/60"
        />
      </td>
    );
  }
  // Pass-through for numeric strings ("25", "500"); look up
  // language-agnostic words ("Unlimited") through MATRIX_VALUE_KEYS.
  const valueKey = MATRIX_VALUE_KEYS[value];
  const display = valueKey ? t(`values.${valueKey}`) : value;
  return (
    <td className="px-4 py-3 text-center align-top text-sm font-medium">
      {display}
    </td>
  );
}

/** Translated FAQ list. Order is locked here (keys read top-to-
 *  bottom in the rendered page). When adding a question, append a
 *  new key + add it to both en.json and it.json under
 *  `pricingPage.faqs.<key>`. Body content allows simple inline
 *  links via standard Markdown-like substitution — we keep the
 *  links inline in the translations file as plain text since the
 *  current copy uses static URLs only. */
const FAQ_KEYS = [
  "freeTier",
  "trialHowItWorks",
  "switchPlans",
  "aiGenerationCount",
  "dataStorage",
  "refunds",
] as const;

function PricingFaq() {
  const t = useTranslations("pricingPage.faqs");
  return (
    <dl className="mt-5 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
      {FAQ_KEYS.map((key) => (
        <div
          key={key}
          className="px-5 py-4"
        >
          <dt className="text-sm font-medium">{t(`${key}.q`)}</dt>
          <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t(`${key}.a`)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
