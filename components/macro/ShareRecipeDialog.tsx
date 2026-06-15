"use client";

import { Button } from "@/components/ui/button";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { clientFetch } from "@/lib/auth/client-fetch";
import { upsertRecipe } from "@/lib/db";
import { bumpPending } from "@/lib/sync-status";
import { useState } from "react";
import {
  Check,
  Copy,
  EyeOff,
  Globe,
  Loader2,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { Recipe, ShareVisibility } from "./types";

/** Share dialog for one recipe. Three states:
 *  - **Not shared yet** → "Create shareable link" button mints a slug
 *    via `POST /api/recipes/[id]/share`. On success, the dialog
 *    flips into the "shared" state and updates the local IDB record
 *    so the row's `shareSlug` reflects reality (the next sync pull
 *    would also catch this, but the optimistic write keeps the UI
 *    consistent immediately and prevents a subsequent edit-and-push
 *    from clobbering the server's `share_slug` back to null).
 *  - **Shared** → shows the public URL with a copy-to-clipboard
 *    button, the path to the `/r/<slug>` page, and a "Revoke link"
 *    button that calls `DELETE /api/recipes/[id]/share` and zeroes
 *    the local `shareSlug`.
 *  - **Working** → in-flight spinner during mint / revoke.
 *
 *  The dialog is presentational from the IDB's perspective - the
 *  network call is the source of truth, and the local upsert is just
 *  bringing IDB in line with what the server has already accepted. */
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The recipe to share. `null` keeps the dialog mounted but inert
   *  (matches the parent's pattern of holding a single dialog open
   *  state alongside a "which recipe" variable). */
  recipe: Recipe | null;
  /** Called after a successful mint or revoke so the parent list can
   *  refresh its in-memory snapshot. The IDB has already been
   *  updated; this is just a notification. */
  onChanged?: () => void;
};

export function ShareRecipeDialog({
  open,
  onOpenChange,
  recipe,
  onChanged,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        {open && recipe && (
          <ShareBody
            recipe={recipe}
            onChanged={onChanged}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type VisibilityOption = {
  value: ShareVisibility;
  label: string;
  description: string;
  Icon: typeof Globe;
};

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: "public",
    label: "Public",
    description: "Anyone with the link can view.",
    Icon: Globe,
  },
  {
    value: "members",
    label: "Members only",
    description: "Visitors must sign in to view.",
    Icon: Users,
  },
  {
    value: "disabled",
    label: "Disabled",
    description: "Link 404s for everyone. The URL stays - re-enable any time.",
    Icon: EyeOff,
  },
];

function ShareBody({
  recipe,
  onChanged,
  onClose,
}: {
  recipe: Recipe;
  onChanged?: () => void;
  onClose: () => void;
}) {
  // Track the slug + visibility locally so the dialog reflects
  // mint/revoke/visibility-change without waiting for a parent
  // re-render. Initial values come from the recipe prop.
  const [slug, setSlug] = useState<string | undefined>(recipe.shareSlug);
  const [visibility, setVisibility] = useState<ShareVisibility>(
    recipe.shareVisibility ?? "public",
  );
  const [working, setWorking] = useState<
    "mint" | "revoke" | "visibility" | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const url =
    slug && typeof window !== "undefined"
      ? `${window.location.origin}/r/${slug}`
      : "";

  async function mint() {
    if (working) return;
    setWorking("mint");
    setError(null);
    try {
      const res = await clientFetch(`/api/recipes/${recipe.id}/share`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error ?? "Couldn't create the share link. Please try again.",
        );
      }
      const data = (await res.json()) as {
        slug: string;
        visibility?: ShareVisibility;
      };
      const newVisibility = data.visibility ?? "public";
      // Mirror the server-side change into IDB so the row's local
      // `shareSlug` + `shareVisibility` are the new values. Without
      // this, the next local edit + sync push would send
      // `share_slug: null` (from the stale IDB row) and revoke the
      // share. upsertRecipe bumps localUpdatedAt; the resulting sync
      // push is idempotent because the server already has the values.
      await upsertRecipe({
        ...recipe,
        shareSlug: data.slug,
        shareVisibility: newVisibility,
      });
      bumpPending();
      setSlug(data.slug);
      setVisibility(newVisibility);
      onChanged?.();
      toast.success("Share link created");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't create the share link. Please try again.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function changeVisibility(next: ShareVisibility) {
    if (working || !slug || next === visibility) return;
    setWorking("visibility");
    setError(null);
    // Optimistic so the radio reflects the change immediately.
    const previous = visibility;
    setVisibility(next);
    try {
      const res = await clientFetch(`/api/recipes/${recipe.id}/share`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error ?? "Couldn't update the share link. Please try again.",
        );
      }
      await upsertRecipe({ ...recipe, shareVisibility: next });
      bumpPending();
      onChanged?.();
      toast.success(
        next === "public"
          ? "Anyone with the link can view"
          : next === "members"
            ? "Members only - viewers must sign in"
            : "Link disabled - re-enable any time",
      );
    } catch (err) {
      // Revert the optimistic update on failure so the UI matches reality.
      setVisibility(previous);
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't update the share link. Please try again.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function revoke() {
    if (working || !slug) return;
    setWorking("revoke");
    setError(null);
    try {
      const res = await clientFetch(`/api/recipes/${recipe.id}/share`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error ?? "Couldn't remove the share link. Please try again.",
        );
      }
      // Strip shareSlug + shareVisibility locally so the row reflects
      // the revoked state. Same dirty-row argument as mint - the local
      // push will idempotently re-confirm both as null.
      const { shareSlug: _slug, shareVisibility: _vis, ...rest } = recipe;
      void _slug;
      void _vis;
      await upsertRecipe(rest);
      bumpPending();
      setSlug(undefined);
      setVisibility("public");
      onChanged?.();
      toast.success("Share link revoked");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't remove the share link. Please try again.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Couldn't copy automatically - long-press the field and copy manually.",
      );
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share &ldquo;{recipe.name}&rdquo;</DialogTitle>
        <DialogDescription>
          Anyone with the link can view the recipe. Signed-in viewers see an
          &ldquo;Import to my recipes&rdquo; button on the public page.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        {slug ? (
          <>
            <div className="space-y-1.5">
              <label
                htmlFor="share-url"
                className="text-xs font-medium text-muted-foreground"
              >
                Link
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="share-url"
                  value={url}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyUrl}
                  className="h-10 shrink-0 gap-1.5 sm:h-9"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">
                Who can see it
              </legend>
              <div className="space-y-1.5">
                {VISIBILITY_OPTIONS.map((opt) => {
                  const selected = visibility === opt.value;
                  const isWorking = working === "visibility" && selected;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => changeVisibility(opt.value)}
                      disabled={working !== null}
                      className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? "border-foreground/40 bg-accent/50"
                          : "border-border/60 hover:bg-accent/30"
                      }`}
                      aria-pressed={selected}
                    >
                      <opt.Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-foreground" : "text-muted-foreground"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          {opt.label}
                          {isWorking && (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {opt.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <p className="text-xs text-muted-foreground">
              Tip: the public page has a Print button that browsers turn into{" "}
              <strong>Save as PDF</strong> - handy for sending recipes to people
              who don&apos;t use Maqro.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmingRevoke(true)}
              disabled={working !== null}
              className="h-10 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-9"
            >
              {working === "revoke" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {working === "revoke" ? "Revoking…" : "Revoke link (delete URL)"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              This recipe isn&apos;t shared yet. Generate a public link to send
              it to someone - they can view it in their browser, print it as a
              PDF, or import a copy into their own recipes.
            </p>
            <Button
              type="button"
              onClick={mint}
              disabled={working !== null}
              className="h-10 w-full gap-1.5 sm:h-9 sm:w-auto"
            >
              {working === "mint" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {working === "mint" ? "Creating link…" : "Create shareable link"}
            </Button>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="text-xs text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Done
        </Button>
      </DialogFooter>

      <DestructiveConfirmDialog
        open={confirmingRevoke}
        onOpenChange={setConfirmingRevoke}
        title="Revoke this link?"
        description="Anyone with the URL will get a 404. You can create a new link later, but it'll be a different URL."
        actionLabel="Revoke link"
        onConfirm={() => void revoke()}
      />
    </>
  );
}
