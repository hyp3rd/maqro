"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LogIn } from "lucide-react";

/** The "this needs an account" prompt — shown when a signed-out user taps
 *  an AI feature, instead of a toast that vanishes before it's read.
 *
 *  Deliberately a lightweight prompt that ROUTES to /login rather than an
 *  embedded auth form: the login page owns the whole flow (PKCE, passkeys,
 *  MFA step-up) and duplicating it in a modal would fork that machinery.
 *  Navigation is a hard assign, not router.push — the cookie state needs a
 *  full reload to settle (same reasoning as RecipesView's session-expired
 *  redirect), and /login sanitizes `next` to same-origin paths. */
export function SignInPromptDialog({
  open,
  onOpenChange,
  feature,
  next = "/app",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the user tried to do, e.g. "AI meal planning" — keeps the
   *  prompt specific instead of a generic wall. */
  feature?: string;
  /** Same-origin path to land back on after authenticating. */
  next?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in to continue</DialogTitle>
          <DialogDescription>
            {feature ?? "This feature"} uses your monthly AI allowance, which is
            tied to your account. Sign in — or create a free account — and
            everything you&apos;ve logged on this device comes with you.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            onClick={() =>
              window.location.assign(`/login?next=${encodeURIComponent(next)}`)
            }
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
