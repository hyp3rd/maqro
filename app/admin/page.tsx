import { CopyableId } from "@/components/admin/CopyableId";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellOff,
  Clock,
  CreditCard,
  History,
  LayoutDashboard,
  MousePointerClick,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

/** Admin landing — a small dashboard of counts. Server-rendered
 *  so the numbers are fresh on every visit and we don't ship a
 *  client-side fetcher. Reads via the service-role client (RLS
 *  bypassed) since this page is already gated by the layout. */

export const dynamic = "force-dynamic";

type Stats = {
  profiles: number;
  admins: number;
  premium: number;
  errorsLast24h: number;
  webhookEventsLast24h: number;
  pushSendsLast24h: number;
  pushExpiredLast24h: number;
  pushFailedLast24h: number;
  pushClicksLast24h: number;
};

type RecentAuditRow = {
  id: string;
  created_at: string;
  action: string;
  target_user_id: string | null;
};

async function load(): Promise<{
  stats: Stats;
  recentAudit: RecentAuditRow[];
} | null> {
  const config = getSupabaseSecretConfig();
  if (!config) return null;
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [
    { count: profilesCount },
    { count: adminsCount },
    { count: premiumCount },
    { count: errorsLast24h },
    { count: webhookEventsLast24h },
    { count: pushSendsLast24h },
    { count: pushExpiredLast24h },
    { count: pushFailedLast24h },
    { count: pushClicksLast24h },
    { data: recentAuditRows },
  ] = await Promise.all([
    admin.from("profiles").select("user_id", { count: "exact", head: true }),
    admin
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin"),
    admin
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("is_premium", true),
    admin
      .from("error_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    admin
      .from("stripe_webhook_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    // Push delivery counts split by outcome. "ok" = provider accepted,
    // "gone" = 410/404 and the subscription was reaped, "fail" =
    // everything else (5xx, auth issue). Splitting them surfaces
    // distinct operational signals: a spike in "gone" means lots of
    // users uninstalling the PWA; a spike in "fail" means a VAPID /
    // provider issue worth investigating.
    admin
      .from("push_send_log")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "ok")
      .gte("sent_at", since24h),
    admin
      .from("push_send_log")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "gone")
      .gte("sent_at", since24h),
    admin
      .from("push_send_log")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "fail")
      .gte("sent_at", since24h),
    // Click events from the service worker's notificationclick
    // handler. CTR (clicks ÷ sends) computed at render time below.
    admin
      .from("push_event_log")
      .select("id", { count: "exact", head: true })
      .eq("event", "click")
      .gte("created_at", since24h),
    admin
      .from("admin_audit_log")
      .select("id, created_at, action, target_user_id")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return {
    stats: {
      profiles: profilesCount ?? 0,
      admins: adminsCount ?? 0,
      premium: premiumCount ?? 0,
      errorsLast24h: errorsLast24h ?? 0,
      webhookEventsLast24h: webhookEventsLast24h ?? 0,
      pushSendsLast24h: pushSendsLast24h ?? 0,
      pushExpiredLast24h: pushExpiredLast24h ?? 0,
      pushFailedLast24h: pushFailedLast24h ?? 0,
      pushClicksLast24h: pushClicksLast24h ?? 0,
    },
    recentAudit: (recentAuditRows as RecentAuditRow[] | null) ?? [],
  };
}

export default async function AdminHome() {
  const data = await load();

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        Supabase service-role key isn&apos;t configured on this deployment.
      </p>
    );
  }

  const { stats, recentAudit } = data;

  return (
    <div className="space-y-8">
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        description="Live snapshot of the deployment. No caching — every load re-queries."
      />

      <section
        aria-label="Identity"
        className="space-y-3"
      >
        <SectionHeading>People</SectionHeading>
        {/* Three short counts fit at 375px; `grid-cols-2 sm:grid-cols-3` left
            the third card orphaned on its own row on phones. */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Profiles"
            value={stats.profiles.toLocaleString()}
            icon={Users}
            href="/admin/users"
          />
          <StatCard
            label="Admins"
            value={stats.admins.toLocaleString()}
            icon={ShieldCheck}
            href="/admin/users?filter=all"
            hint={`${stats.admins} of ${stats.profiles}`}
            tone="amber"
          />
          <StatCard
            label="Premium"
            value={stats.premium.toLocaleString()}
            icon={CreditCard}
            href="/admin/users?filter=premium"
            tone="emerald"
            hint={
              stats.profiles > 0
                ? `${Math.round((stats.premium / stats.profiles) * 100)}% of users`
                : undefined
            }
          />
        </div>
      </section>

      <section
        aria-label="Health (last 24h)"
        className="space-y-3"
      >
        <SectionHeading>Health · last 24h</SectionHeading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard
            label="Errors"
            value={stats.errorsLast24h.toLocaleString()}
            icon={AlertTriangle}
            tone={
              stats.errorsLast24h > 50
                ? "red"
                : stats.errorsLast24h > 0
                  ? "amber"
                  : "default"
            }
            href="/admin/errors"
            hint={
              stats.errorsLast24h === 0
                ? "Quiet — nothing to triage."
                : "Click to drill in."
            }
          />
          <StatCard
            label="Webhooks"
            value={stats.webhookEventsLast24h.toLocaleString()}
            icon={Webhook}
            href="/admin/webhooks"
            hint={
              stats.webhookEventsLast24h === 0
                ? "No Stripe activity."
                : `${stats.webhookEventsLast24h} Stripe events processed`
            }
          />
        </div>
      </section>

      <section
        aria-label="Engagement (last 24h)"
        className="space-y-3"
      >
        <SectionHeading>Engagement · last 24h</SectionHeading>
        {/* Stay 2-up until lg — four 2rem-headline cards are cramped at the
            sm breakpoint; they only breathe at desktop widths. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Push sent"
            value={stats.pushSendsLast24h.toLocaleString()}
            icon={Bell}
            hint={
              stats.pushSendsLast24h === 0
                ? "No push notifications dispatched."
                : "Successful provider responses (201)."
            }
          />
          <StatCard
            label="Push clicked"
            value={stats.pushClicksLast24h.toLocaleString()}
            icon={MousePointerClick}
            tone={stats.pushClicksLast24h > 0 ? "emerald" : "default"}
            hint={
              stats.pushSendsLast24h === 0
                ? "—"
                : `CTR ${formatCtr(stats.pushClicksLast24h, stats.pushSendsLast24h)}`
            }
          />
          <StatCard
            label="Push expired"
            value={stats.pushExpiredLast24h.toLocaleString()}
            icon={BellOff}
            hint={
              stats.pushExpiredLast24h === 0
                ? "No subscriptions reaped."
                : "Endpoints returned 410/404 and were pruned."
            }
          />
          <StatCard
            label="Push failed"
            value={stats.pushFailedLast24h.toLocaleString()}
            icon={AlertTriangle}
            tone={stats.pushFailedLast24h > 10 ? "red" : "default"}
            hint={
              stats.pushFailedLast24h === 0
                ? "No transient errors."
                : "5xx / auth / VAPID-config issues."
            }
          />
        </div>
      </section>

      <section
        aria-label="Recent admin activity"
        className="space-y-3"
      >
        <div className="flex items-center justify-between">
          <SectionHeading>Recent admin activity</SectionHeading>
          <Link
            href="/admin/audit"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Full audit log <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        {recentAudit.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card">
            <EmptyState
              icon={History}
              title="No admin actions yet"
              description="Role changes, account deletes, and webhook replays will show up here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
            {recentAudit.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-mono text-[11px] font-medium">
                    {row.action}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>target</span>
                    {row.target_user_id ? (
                      <CopyableId value={row.target_user_id} />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {relativeTime(row.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Compact "5 min ago" / "2h ago" / "yesterday" — chosen over a
 *  full timestamp because the audit-log page already shows the
 *  exact time. The overview is for scanning. */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Click-through rate as a one-decimal percentage. Empty-string for
 *  a zero-send window so the description line doesn't read "NaN %".
 *  >100% can technically happen if a campaign re-fires close to a
 *  24h boundary and clicks bleed across the window — clamped here
 *  so the headline never looks broken; the cron's own counts are
 *  what we'd dig into. */
function formatCtr(clicks: number, sends: number): string {
  if (sends === 0) return "—";
  const ratio = Math.min(clicks / sends, 1);
  return `${(ratio * 100).toFixed(1)}%`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}
