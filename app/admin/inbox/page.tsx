import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { listDismissedEmailIds } from "@/lib/email/dismissed";
import { listReceivedEmails } from "@/lib/email/receiving";
import { requireAdmin } from "@/lib/rbac";
import { Inbox as InboxIcon, MailWarning } from "lucide-react";
import { redirect } from "next/navigation";
import { InboxList } from "./InboxList";
import { InboxTabs } from "./InboxTabs";

export const dynamic = "force-dynamic";

/** Resend-backed admin inbox. Lists every email Resend has
 *  received for the inbound domain — support replies, customer-
 *  initiated mail, anything the operator's configured to forward.
 *  Click a row → detail page with body + attachments. */
export default async function AdminInboxPage() {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/app");

  const result = await listReceivedEmails();

  if (!result.ok) {
    if (result.error.kind === "not-configured") {
      return (
        <div className="space-y-6">
          <PageHeader
            icon={InboxIcon}
            title="Inbox"
            description="Resend-backed inbound mail. Configure RESEND_API_KEY to enable."
          />
          <InboxTabs />
          <EmptyState
            icon={MailWarning}
            title="Resend isn't configured"
            description="Set RESEND_API_KEY in the environment and point your inbound domain at Resend's MX records to start receiving mail here."
          />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <PageHeader
          icon={InboxIcon}
          title="Inbox"
          description="Resend-backed inbound mail."
        />
        <InboxTabs />
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-600">
          Resend API error: {result.error.message}
        </div>
      </div>
    );
  }

  const dismissed = await listDismissedEmailIds();
  const emails = result.emails.filter((e) => !dismissed.has(e.id));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={InboxIcon}
        title="Inbox"
        description={
          emails.length === 0
            ? "Resend hasn't received any mail yet — once your inbound MX is configured, messages show up here. You can still compose new outbound mail from the Compose button."
            : `${emails.length} message${emails.length === 1 ? "" : "s"} received.`
        }
      />
      <InboxTabs />
      <InboxList emails={emails} />
    </div>
  );
}
