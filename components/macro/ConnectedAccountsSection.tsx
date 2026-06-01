"use client";

import { AppleLogo } from "@/components/icons/AppleLogo";
import { GoogleLogo } from "@/components/icons/GoogleLogo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import * as React from "react";
import { CheckCircle2, Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import type { UserIdentity } from "@supabase/supabase-js";

/** Settings → Connected accounts.
 *
 *  Lists external OAuth providers the user has linked, with affordances
 *  to connect a new one or disconnect an existing one.
 *
 *  Why providers are a discrete UI concept rather than just "auth
 *  methods": Supabase models each linked provider as a row in
 *  `auth.identities`. A single user can have 1..N identities (email,
 *  Google, etc.) and any of them can be used to sign in. The Settings
 *  surface mirrors that data model directly.
 *
 *  Google and Apple are wired in — the `PROVIDERS` constant below is
 *  the single switch. Add a row there and the rest of the component
 *  picks it up. */

type ProviderKey = "google" | "apple";

type ProviderMeta = {
  key: ProviderKey;
  label: string;
  Logo: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const PROVIDERS: ProviderMeta[] = [
  { key: "google", label: "Google", Logo: GoogleLogo },
  { key: "apple", label: "Apple", Logo: AppleLogo },
];

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; identities: UserIdentity[] }
  | { kind: "error"; message: string };

export function ConnectedAccountsSection({ signedIn }: { signedIn: boolean }) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = React.useState<{
    action: "linking" | "unlinking";
    provider: ProviderKey;
  } | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    supabase.auth.getUserIdentities().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setState({ kind: "error", message: error.message });
        return;
      }
      setState({ kind: "ok", identities: data?.identities ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, tick]);

  function refresh() {
    setTick((t) => t + 1);
  }

  /** Begin the link flow for a provider. Supabase's `linkIdentity`
   *  returns a URL the browser must navigate to (Google's consent
   *  screen). The browser-side SDK auto-redirects, so this function
   *  rarely returns — the page that comes back is the OAuth landing,
   *  which `/auth/callback` exchanges for a session. */
  async function linkProvider(provider: ProviderKey) {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      toast.error("Supabase isn't configured on this deployment.");
      return;
    }
    setBusy({ action: "linking", provider });
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: {
          // Land the user back in Settings after the consent
          // screen so they see the newly-linked row.
          redirectTo: `${window.location.origin}/app?view=settings`,
        },
      });
      if (error) {
        toast.error(error.message);
        setBusy(null);
      }
      // Success path: auto-redirect; nothing else to do here.
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't start linking flow.",
      );
      setBusy(null);
    }
  }

  /** Unlink a provider. Supabase rejects unlinking the user's last
   *  identity (that'd lock them out), so the UI only offers
   *  disconnect when there's at least one other identity to fall
   *  back on. Defense-in-depth: the server still enforces this. */
  async function unlinkProvider(identity: UserIdentity, provider: ProviderKey) {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setBusy({ action: "unlinking", provider });
    try {
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Disconnected ${provider}.`);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!signedIn) return null;

  const header = (
    <header className="border-b border-border/60 px-5 py-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        Connected accounts
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Sign in with these providers in addition to (or instead of) your email
        code.
      </p>
    </header>
  );

  if (state.kind === "loading") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <div className="px-5 py-6 text-center text-xs text-muted-foreground">
          <Loader2 className="mx-auto mb-1.5 h-4 w-4 animate-spin" />
          Loading…
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        {header}
        <p
          role="alert"
          className="px-5 py-4 text-xs text-red-600"
        >
          {state.message}
        </p>
      </section>
    );
  }

  // Identities table — render a row per supported provider, looking
  // up whether the user has a matching `auth.identities` entry. The
  // user can have at most one identity per provider in Supabase
  // today; if that ever changes we'd surface the first.
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
      {header}
      <ul className="divide-y divide-border/60">
        {PROVIDERS.map(({ key, label, Logo }) => {
          const identity = state.identities.find((i) => i.provider === key);
          const isLinked = identity !== undefined;
          // Last-identity protection: Supabase rejects unlinking
          // when it would leave the user with zero identities,
          // because there'd be no way to sign in afterwards. Mirror
          // that constraint in the UI to avoid showing a button
          // that's guaranteed to error.
          const canUnlink = isLinked && state.identities.length > 1;
          const linkingThis =
            busy?.provider === key && busy.action === "linking";
          const unlinkingThis =
            busy?.provider === key && busy.action === "unlinking";
          return (
            <li
              key={key}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Logo className="h-5 w-5 shrink-0" />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {label}
                    {isLinked && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </p>
                  {isLinked ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      Connected
                      {identity?.identity_data?.email
                        ? ` as ${identity.identity_data.email}`
                        : ""}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Not connected
                    </p>
                  )}
                </div>
              </div>
              {isLinked ? (
                canUnlink ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
                        disabled={unlinkingThis || linkingThis}
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect {label}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          You&apos;ll still be able to sign in via the email
                          code or any other connected provider. Reconnect any
                          time from this page.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={unlinkingThis}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault();
                            if (identity) {
                              void unlinkProvider(identity, key);
                            }
                          }}
                          disabled={unlinkingThis}
                        >
                          {unlinkingThis ? "Disconnecting…" : "Disconnect"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  // Only one identity remains; offer no disconnect
                  // affordance — see comment on `canUnlink`.
                  <span
                    className="text-[11px] text-muted-foreground"
                    title="Disconnect disabled — this is your only sign-in method"
                  >
                    Sole sign-in
                  </span>
                )
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void linkProvider(key)}
                  disabled={linkingThis || unlinkingThis}
                  className="h-8 shrink-0 gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {linkingThis ? "Opening…" : "Connect"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
