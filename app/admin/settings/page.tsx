import { PageHeader } from "@/components/admin/PageHeader";
import { getSetting, SETTING_DEFAULTS, SETTING_KEYS } from "@/lib/app-settings";
import { requireAdmin } from "@/lib/rbac";
import { Settings as SettingsIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { SettingsEditor } from "./SettingsEditor";

export const dynamic = "force-dynamic";

/** Admin settings — small surface today (just the contact-form
 *  receiver address) but the page is shaped so adding more
 *  whitelisted settings later is mechanical: extend SETTING_KEYS,
 *  add a row in SettingsEditor. */
export default async function AdminSettingsPage() {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/app");

  const supportInbox = await getSetting(
    SETTING_KEYS.supportInbox,
    SETTING_DEFAULTS[SETTING_KEYS.supportInbox],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={SettingsIcon}
        title="App settings"
        description="Runtime-configurable values. Edits propagate within ~60 seconds — no redeploy needed."
      />
      <SettingsEditor initial={{ supportInbox }} />
    </div>
  );
}
