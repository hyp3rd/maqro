"use client";

import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/version";
import { useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Manual "Check for updates" button — companion to the
 *  background poll in [hooks/use-version-check.ts](../../hooks/use-version-check.ts).
 *  Hits the same `/api/version` endpoint and discriminates the
 *  result into three user-visible outcomes:
 *
 *    - **Up to date**: server version matches the bundled
 *      `APP_VERSION`. Render a green "You're on the latest"
 *      acknowledgement.
 *    - **Update available**: server reports a different version.
 *      Render a CTA toast offering to reload; reload picks up
 *      the new SW + bundle on the next document load.
 *    - **Error**: network blip / Vercel hiccup. Render an
 *      apologetic toast — same swallow-and-recover policy as
 *      the background poll, but visible here because the user
 *      asked.
 *
 *  Why a client component for this small thing: the version
 *  *check* needs the bundled APP_VERSION constant baked into
 *  the browser bundle (the comparison's whole point is "what's
 *  shipped in this tab vs what the server says now"). A server
 *  component couldn't get that signal without proxying through
 *  /api/version itself, which is what we're calling anyway. */
export function CheckForUpdatesButton() {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "current" }
    | { kind: "update"; serverVersion: string }
  >({ kind: "idle" });

  async function check() {
    setState({ kind: "checking" });
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { version?: string };
      const serverVersion =
        typeof data.version === "string" ? data.version : "";
      if (!serverVersion) throw new Error("Server didn't report a version.");
      if (serverVersion === APP_VERSION) {
        setState({ kind: "current" });
        toast.success(`You're on the latest version (v${APP_VERSION}).`);
      } else {
        setState({ kind: "update", serverVersion });
        toast(`New version v${serverVersion} available — reload to upgrade.`, {
          action: { label: "Reload", onClick: () => window.location.reload() },
          duration: 10_000,
        });
      }
    } catch (err) {
      setState({ kind: "idle" });
      toast.error(
        err instanceof Error
          ? `Couldn't check for updates: ${err.message}`
          : "Couldn't check for updates.",
      );
    }
  }

  const busy = state.kind === "checking";

  return (
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void check()}
        disabled={busy}
        className="gap-1.5"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {busy ? "Checking…" : "Check for updates"}
      </Button>
      {state.kind === "current" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          <Check className="h-3 w-3" />
          On the latest (v{APP_VERSION}).
        </span>
      )}
      {state.kind === "update" && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-[11px] text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
        >
          v{state.serverVersion} available — reload to upgrade.
        </button>
      )}
    </div>
  );
}
