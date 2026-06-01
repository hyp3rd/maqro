import { requireAdmin } from "@/lib/rbac";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OutgoingDetail } from "./OutgoingDetail";

export const dynamic = "force-dynamic";

/** Server shell — the role check + back-link chrome. All the
 *  interactive state (live status fetch, cancel button) lives in
 *  the client component so the cancel round-trip can update the
 *  page without a full reload. */
export default async function OutgoingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/app");

  const { id } = await params;

  return (
    <div className="space-y-4">
      <Link
        href="/admin/inbox/outgoing"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to outgoing
      </Link>
      <OutgoingDetail id={id} />
    </div>
  );
}
