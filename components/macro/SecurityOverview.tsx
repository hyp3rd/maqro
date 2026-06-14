"use client";

import { ShieldCheck } from "lucide-react";
import {
  type SecurityStat,
  type SecurityStatusKey,
  useSecurityStats,
} from "./security-status";

/** "Is my account protected?" at a glance — a compact summary card at the top
 *  of the Security group. Each protection reports its status up via the
 *  security-status context; this just renders the ones that have resolved (so
 *  it fills in progressively as the sections below load). Renders nothing until
 *  at least one section reports, to avoid a flash of an empty card. */

const ORDER: { key: SecurityStatusKey; label: string }[] = [
  { key: "twoStep", label: "Two-step" },
  { key: "passkeys", label: "Passkeys" },
  { key: "backupEmail", label: "Backup email" },
  { key: "trustedDevices", label: "Trusted devices" },
];

export function SecurityOverview() {
  const stats = useSecurityStats();
  // Resolve each label to its reported stat and keep only the ones that have
  // arrived (the type guard narrows `stat` to non-undefined — no `!`).
  const present = ORDER.map((o) => ({ ...o, stat: stats[o.key] })).filter(
    (o): o is { key: SecurityStatusKey; label: string; stat: SecurityStat } =>
      Boolean(o.stat),
  );
  if (present.length === 0) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-card px-5 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        Your account security
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        A quick read on how your account is protected. Details are in the
        sections below.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {present.map((o) => (
          <li key={o.key}>
            <StatPill
              label={o.label}
              stat={o.stat}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatPill({ label, stat }: { label: string; stat: SecurityStat }) {
  const dot =
    stat.tone === "good"
      ? "bg-emerald-500"
      : "bg-muted-foreground/40 dark:bg-muted-foreground/50";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px]">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{stat.value}</span>
    </span>
  );
}
