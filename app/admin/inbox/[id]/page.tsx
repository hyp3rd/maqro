import { EmptyState } from "@/components/admin/EmptyState";
import {
  getReceivedEmail,
  listReceivedAttachments,
} from "@/lib/email/receiving";
import { requireAdmin } from "@/lib/rbac";
import { ArrowLeft, MailX } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EmailDetail } from "./EmailDetail";

export const dynamic = "force-dynamic";

export default async function InboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/app");

  const { id } = await params;

  // Fetch body + attachments in parallel to halve the perceived
  // load time on a detail open.
  const [emailRes, attachmentsRes] = await Promise.all([
    getReceivedEmail(id),
    listReceivedAttachments(id),
  ]);

  if (!emailRes.ok) {
    if (emailRes.error.kind === "not-found") notFound();
    if (emailRes.error.kind === "not-configured") {
      return (
        <div className="space-y-4">
          <BackLink />
          <EmptyState
            icon={MailX}
            title="Resend isn't configured"
            description="Set RESEND_API_KEY to enable the inbox."
          />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-600">
          {emailRes.error.message}
        </div>
      </div>
    );
  }

  const attachments = attachmentsRes.ok ? attachmentsRes.attachments : [];

  return (
    <div className="space-y-4">
      <BackLink />
      <EmailDetail
        email={emailRes.email}
        attachments={attachments}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/inbox"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to inbox
    </Link>
  );
}
