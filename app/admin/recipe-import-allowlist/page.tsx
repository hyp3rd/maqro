import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireAdmin } from "@/lib/rbac";
import { getSupabaseSecretConfig } from "@/lib/supabase/env";
import { Link2, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { AllowlistManager } from "./AllowlistManager";

export const dynamic = "force-dynamic";

type Entry = {
  hostname: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

/** Admin page for the recipe-import hostname allowlist.
 *
 *  The semantics are deliberately bimodal:
 *    - Empty list → "open mode": any public host can be imported
 *      (the SSRF defenses in lib/recipe-import/* are the only gates).
 *    - Any entries → "restrict mode": ONLY listed hosts (and their
 *      subdomains) can be imported.
 *
 *  The page header makes this prominent because the wrong mental
 *  model here can mean either (a) admin thinks they've allowed
 *  example.com when there are no other entries → discovers later
 *  they've inadvertently put the whole feature in restrict mode, or
 *  (b) admin thinks they're in restrict mode but the table is empty
 *  → the feature is open. We surface the current mode in big text
 *  above the list. */
export default async function RecipeImportAllowlistPage() {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/app");

  const secret = getSupabaseSecretConfig();
  if (!secret) {
    return (
      <div className="space-y-4">
        <PageHeader
          icon={Link2}
          title="Recipe import allowlist"
          description="Restrict the recipe-import-from-URL feature to a curated set of hostnames."
        />
        <EmptyState
          icon={ShieldAlert}
          title="Service-role key not configured"
          description="This deployment can't read the allowlist table. Configure SUPABASE_SECRET_KEY."
        />
      </div>
    );
  }
  const admin = createClient(secret.url, secret.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from("recipe_import_host_allowlist")
    .select("hostname, note, created_at, created_by")
    .order("hostname", { ascending: true });

  const entries = (data ?? []) as Entry[];
  const mode = entries.length === 0 ? "open" : "restricted";

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Link2}
        title="Recipe import allowlist"
        description="Restrict the recipe-import-from-URL feature to a curated set of hostnames. Subdomains are allowed automatically."
      />

      <section className="rounded-lg border border-border/60 bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Current mode
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-sm font-medium">
              {mode === "open" ? (
                <>
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  Open — any public host can be imported
                </>
              ) : (
                <>
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  Restricted — only listed hosts can be imported
                </>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-mono text-base text-foreground">
              {entries.length}
            </div>
            <div>entries</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          Add the first entry to switch this feature into restrict mode. Remove
          all entries to switch back to open mode. The SSRF defenses
          (HTTPS-only, IP-range blocking, DNS-rebinding dispatcher) apply in
          either mode.
        </p>
      </section>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-600">
          Couldn&apos;t load the allowlist: {error.message}
        </div>
      )}

      <AllowlistManager initialEntries={entries} />
    </div>
  );
}
