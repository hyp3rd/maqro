import { MfaChallengeDialog } from "@/components/auth/MfaChallengeDialog";
import { LogoMark } from "@/components/shell/LogoMark";
import { LogoWordmark } from "@/components/shell/LogoWordmark";
import { touchAdminSession } from "@/lib/admin-sessions";
import { getSupabaseServer } from "@/lib/supabase/server";
import { Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "./AdminNav";

export const metadata: Metadata = {
  title: "Admin — Maqro",
  // Don't expose admin URLs to search engines, ever.
  robots: { index: false, follow: false },
};

/** Admin layout — wraps every `/admin/*` page.
 *
 *  Three responsibilities:
 *
 *    1. **Role gate** — non-admins get bounced to /app. The
 *       page-level redirect is the security boundary; every
 *       admin API route also re-checks via `requireAdmin()`
 *       (defense in depth).
 *
 *    2. **Session tracking** — on every render we touch the
 *       operator's `admin_sessions` row, opening a new one if
 *       this is the first visit (or after a 30-min idle gap)
 *       and bumping `last_active_at` otherwise. Lifecycle
 *       transitions write to `admin_audit_log` under
 *       `admin.session.{start,end}` so the audit page brackets
 *       every action with WHO-was-in-the-room context.
 *
 *    3. **Chrome** — visually distinct from the consumer Topbar
 *       so the operator never forgets they're in admin mode.
 *       The wordmark keeps the product brand intact; the amber
 *       Admin pill + the foreground accent strip across the top
 *       cue "elevated context" without screaming danger zone. */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServer();
  if (!supabase) {
    // Supabase not configured — can't role-check. Bounce.
    redirect("/app");
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Not signed in. Send to login; they'll come back to /admin
    // after auth completes.
    redirect("/login?next=/admin");
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin = (profile?.role as string | undefined) === "admin";
  if (!isAdmin) {
    redirect("/app");
  }

  // Best-effort session touch. Failure is silently swallowed
  // inside `touchAdminSession`; session tracking is
  // observability, not load-bearing. We `await` so the audit
  // emits on session-start happen before the response streams
  // (avoids ordering surprises in the audit page).
  const session = await touchAdminSession(user.id);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20 text-foreground">
      {/* 1-px foreground accent at the very top — a deliberate
       *  visual signal that this surface is "elevated context"
       *  vs the consumer app. Quiet enough to ignore, distinct
       *  enough to never feel like the regular product chrome. */}
      <div
        aria-hidden
        className="h-px bg-foreground/80"
      />
      {/* `pt-safe` lives on the sticky header itself, not on the
       *  parent — when the user scrolls down, only the sticky
       *  element stays pinned, so it's the one that needs to push
       *  its content clear of the iOS camera cutout. `px-safe-or-5`
       *  is the landscape-notch counterpart: it picks the larger of
       *  the safe-area inset or our normal 1.25rem horizontal
       *  padding, so phones in landscape don't crop the brand /
       *  nav under the notch on the side. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 pt-safe shadow-[0_1px_0_0_var(--border)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-safe-or-5 py-3">
          {/* Brand lockup: full wordmark on sm+, mark-only at
           *  mobile. Linked to / so the brand affords escape to
           *  the marketing site, matching the consumer Topbar
           *  behaviour. The Shield pill beside it is the "you're
           *  in admin mode" indicator — the brand IS the brand;
           *  the indicator says "in admin". */}
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/"
              aria-label="Maqro — visit homepage"
              className="inline-flex items-center text-foreground transition-opacity hover:opacity-80"
            >
              <span className="sm:hidden">
                <LogoMark
                  size={20}
                  title=""
                />
              </span>
              <span className="hidden sm:inline-flex">
                <LogoWordmark
                  size={22}
                  title=""
                />
              </span>
            </Link>
            <span
              aria-hidden
              className="h-5 w-px bg-border/60"
            />
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-300"
              title="You're in the admin control panel"
            >
              <Shield className="h-3 w-3" />
              Admin
            </span>
          </div>
          <AdminNav sessionStartedAt={session?.started_at ?? null} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-safe-or-5 py-8">{children}</main>
      {/* Global MFA challenge dialog. Admin routes are gated by
       *  `requireAdmin` → `assertFreshAal2` (no trusted-device
       *  escape), so any privileged action by an AAL1 admin will
       *  return a 403 with `kind: "mfa-required"`. Without this
       *  mount the `clientFetch` wrapper has nothing to call and
       *  rejects with "MFA dialog not mounted", surfacing the raw
       *  403 instead of prompting the user. Mounted once at the
       *  layout level so every admin sub-page inherits it. */}
      <MfaChallengeDialog />
    </div>
  );
}
