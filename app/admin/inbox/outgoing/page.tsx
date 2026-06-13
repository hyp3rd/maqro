import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { Send } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { InboxTabs } from "../InboxTabs";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  admin_user_id: string;
  recipients: string[];
  subject: string;
  in_reply_to: string | null;
  scheduled_at: string | null;
  created_at: string;
};

/** Outgoing list — admin-sent emails from `admin_sent_emails`,
 *  newest first. The row data is enough to drive the list view;
 *  the per-email live Resend status (delivered, opened, etc.)
 *  is fetched on the detail page so the list doesn't fan out
 *  one Resend request per row. */
export default async function AdminOutgoingPage() {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/app");

  const config = getSupabaseSecretConfig();
  if (!config) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Send}
          title="Outgoing"
          description="Admin-issued outbound mail."
        />
        <InboxTabs />
        <EmptyState
          icon={Send}
          title="Supabase isn't configured"
          description="Service-role key missing; the outgoing log can't be read."
        />
      </div>
    );
  }
  const admin = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from("admin_sent_emails")
    .select(
      "id, admin_user_id, recipients, subject, in_reply_to, scheduled_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Send}
          title="Outgoing"
          description="Admin-issued outbound mail."
        />
        <InboxTabs />
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-600">
          {error.message}
        </div>
      </div>
    );
  }

  const rows = (data ?? []) as Row[];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Send}
        title="Outgoing"
        description={
          rows.length === 0
            ? "No outbound mail yet. Use Compose on the Inbox tab to send something."
            : `${rows.length} message${rows.length === 1 ? "" : "s"} sent.`
        }
      />
      <InboxTabs />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-card">
          <EmptyState
            icon={Send}
            title="No outbound mail yet"
            description="Use Compose on the Inbox tab to send a message — it shows up here with live delivery status."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
          {rows.map((row) => (
            <OutgoingRow
              key={row.id}
              row={row}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutgoingRow({ row }: { row: Row }) {
  const recipient = row.recipients[0] ?? "(no recipient)";
  const recipientInitial = (
    recipient.match(/[A-Za-z0-9]/)?.[0] ?? "?"
  ).toUpperCase();
  return (
    <li>
      <Link
        href={`/admin/inbox/outgoing/${encodeURIComponent(row.id)}`}
        className="flex items-start gap-3 px-3 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:py-3.5"
      >
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/90 text-[12px] font-semibold text-background sm:h-10 sm:w-10"
          aria-hidden
        >
          {recipientInitial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">
              {recipient}
              {row.recipients.length > 1 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  +{row.recipients.length - 1}
                </span>
              )}
            </p>
            <time
              dateTime={row.created_at}
              className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              {formatRelative(row.created_at)}
            </time>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-medium text-foreground/85">
            {row.subject}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {row.scheduled_at && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400">
                Scheduled {formatRelative(row.scheduled_at)}
              </span>
            )}
            {row.in_reply_to && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Reply
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = t - Date.now();
  const absMin = Math.floor(Math.abs(diffMs) / 60_000);
  if (absMin < 1) return "now";
  const future = diffMs > 0;
  const fmt = (n: number, unit: string) =>
    future ? `in ${n}${unit}` : `${n}${unit}`;
  if (absMin < 60) return fmt(absMin, "m");
  const hr = Math.floor(absMin / 60);
  if (hr < 24) return fmt(hr, "h");
  const day = Math.floor(hr / 24);
  if (day < 7) return fmt(day, "d");
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
