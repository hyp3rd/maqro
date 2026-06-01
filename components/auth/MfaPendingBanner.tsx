import { getEffectiveUser } from "@/lib/auth/effective-user";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";

/** Sticky-feeling banner shown on the marketing pages when the
 *  caller has a half-completed sign-in (AAL1 session with a
 *  verified TOTP factor pending). The proxy already blocks them
 *  from `/app` and `/admin`, but the marketing pages render with
 *  a signed-out-looking chrome (per `getEffectiveUser`'s mask) —
 *  without this banner a user wouldn't realize WHY their email
 *  no longer appears in the header.
 *
 *  Renders nothing in the common case (signed-out OR fully-
 *  authenticated). Safe to mount at the top of any layout that
 *  shows to mixed-auth users; the check is one cookie read plus
 *  one Supabase API call (and only the cookie read for users with
 *  no MFA enrolled).
 *
 *  Why a server component: the auth check needs the cookie
 *  context, and we want the banner in the initial HTML (no flash
 *  of incorrect chrome). It's a separate file from the headers /
 *  layouts that mount it so any future page can opt in with one
 *  import. */
export async function MfaPendingBanner() {
  const { mfaPending } = await getEffectiveUser();
  if (!mfaPending) return null;
  return (
    <div className="border-b border-amber-500/40 bg-amber-500/15 px-safe-or-5">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 py-2 text-center text-xs text-amber-900 sm:flex-row sm:gap-3 sm:text-left dark:text-amber-200">
        <ShieldAlert
          className="h-4 w-4 shrink-0"
          aria-hidden
        />
        <p className="flex-1">
          <span className="font-semibold">Finish signing in.</span> You verified
          your email, but your account requires a second factor before we treat
          this device as authenticated.
        </p>
        <Link
          href="/login?mfa=required"
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-900 px-3 py-1 text-[11px] font-medium text-amber-50 transition-opacity hover:opacity-90 dark:bg-amber-200 dark:text-amber-900"
        >
          Complete MFA
        </Link>
      </div>
    </div>
  );
}
