"use client";

import { CopyableId } from "@/components/admin/CopyableId";
import { EmptyState } from "@/components/admin/EmptyState";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pill } from "@/components/admin/Pill";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/auth/client-fetch";
import { haptic } from "@/lib/haptics";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Gift,
  Loader2,
  Radio,
  ShieldX,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

/** Admin user detail page — `/admin/users/[id]`.
 *
 *  Renders everything the operator needs to act on a single
 *  user: identity (email, signup, last sign-in), state (role,
 *  banned, traced, billing), and an action panel with Ban /
 *  Unban / Trace / Untrace / Cancel-subscription.
 *
 *  Destructive actions (ban, cancel) require a free-text reason
 *  which is written into the audit log payload — the post-hoc
 *  "why did we do that?" record matters for compliance more than
 *  the action itself. The trace toggle also asks for a reason
 *  (typically a ticket id) so operators can correlate a flag
 *  with a specific investigation.
 *
 *  The page renders client-side because every action is a fetch
 *  + refresh cycle and turning the whole thing into a Server
 *  Component would force a full page reload after each mutation,
 *  which feels heavy. The layout already gates `/admin/*` so
 *  unauthorized callers never reach this component. */

type UserDetail = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  bannedUntil: string | null;
  role: "user" | "admin";
  isPremium: boolean;
  subscriptionStatus: string | null;
  traced: boolean;
  subscription: {
    id: string;
    status: string;
    planLabel: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  comp: { tier: CompTier; expiresAt: string | null } | null;
  recentActions: Array<{
    id: string;
    created_at: string;
    action: string;
    admin_user_id: string;
    payload: Record<string, unknown> | null;
  }>;
};

type CompTier = "plus" | "pro";

type Action =
  | "ban"
  | "unban"
  | "trace"
  | "untrace"
  | "cancel_subscription"
  | "delete_user"
  | "grant_comp"
  | "revoke_comp";

/** Whitelisted ban durations matching the route's accepted set.
 *  "permanent" maps to 100y at the API; we keep the human label
 *  here. The UI defaults to "7d" — long enough to deter abuse,
 *  short enough that an admin's mis-click doesn't permanently
 *  lock out an account. */
type BanDuration = "24h" | "7d" | "30d" | "permanent";
const BAN_DURATION_LABELS: Record<BanDuration, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  permanent: "Permanent (100 years)",
};

const ACTION_LABELS: Record<Action, string> = {
  ban: "Ban account",
  unban: "Lift ban",
  trace: "Trace user",
  untrace: "Stop tracing",
  cancel_subscription: "Cancel subscription",
  delete_user: "Delete user",
  grant_comp: "Grant comp access",
  revoke_comp: "Revoke comp access",
};

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; data: UserDetail }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    void clientFetch(`/api/admin/users/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setState({
            kind: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as UserDetail;
        setState({ kind: "ok", data });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Network error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  function refresh() {
    setReloadKey((k) => k + 1);
  }

  async function doAction(
    action: Action,
    extras: {
      banDuration?: BanDuration;
      compTier?: CompTier;
      compUntil?: string;
    } = {},
  ) {
    setPendingAction(action);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(id)}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason: reason || undefined,
            ...(extras.banDuration ? { banDuration: extras.banDuration } : {}),
            ...(extras.compTier ? { compTier: extras.compTier } : {}),
            ...(extras.compUntil ? { compUntil: extras.compUntil } : {}),
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Action failed (${res.status})`);
        return;
      }
      toast.success(`${ACTION_LABELS[action]} — done.`);
      setReason("");
      refresh();
    } finally {
      setPendingAction(null);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading user…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-3">
        <BackLink />
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {state.message}
        </p>
      </div>
    );
  }

  const u = state.data;
  const isBanned = Boolean(u.bannedUntil);

  return (
    <div className="space-y-5">
      <BackLink />

      <PageHeader
        icon={Users}
        title={u.email ?? "(no email)"}
        tone={u.role === "admin" ? "blue" : isBanned ? "red" : "default"}
        description={
          <CopyableId
            value={u.id}
            display={u.id}
            className="-ml-1"
          />
        }
        actions={
          <>
            <Pill tone={u.role === "admin" ? "blue" : "muted"}>{u.role}</Pill>
            {u.isPremium && <Pill tone="emerald">Premium</Pill>}
            {u.comp && (
              <Pill
                tone="emerald"
                icon={Gift}
              >
                Comp {u.comp.tier}
              </Pill>
            )}
            {isBanned && (
              <Pill
                tone="red"
                icon={Ban}
              >
                Banned
              </Pill>
            )}
            {u.traced && (
              <Pill
                tone="amber"
                icon={Radio}
              >
                Traced
              </Pill>
            )}
          </>
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Identity">
          <Row
            k="Joined"
            v={formatDate(u.created_at)}
          />
          <Row
            k="Last sign-in"
            v={u.last_sign_in_at ? formatDate(u.last_sign_in_at) : "—"}
          />
          {isBanned && (
            <Row
              k="Ban until"
              v={
                u.bannedUntil === "infinity"
                  ? "Permanent"
                  : (u.bannedUntil ?? "—")
              }
            />
          )}
        </Card>

        <Card title="Billing">
          {u.subscription ? (
            <>
              <Row
                k="Plan"
                v={u.subscription.planLabel}
              />
              <Row
                k="Status"
                v={u.subscription.status}
              />
              <Row
                k={u.subscription.cancelAtPeriodEnd ? "Cancels on" : "Renews"}
                v={formatDate(u.subscription.currentPeriodEnd)}
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No subscription.</p>
          )}
        </Card>

        <Card title="Observability">
          <Row
            k="Trace flag"
            v={
              u.traced ? (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <Radio className="h-3 w-3" />
                  Active
                </span>
              ) : (
                <span className="text-muted-foreground">Off</span>
              )
            }
          />
        </Card>
      </section>

      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">Actions</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            All mutations write a row to the admin audit log. Ban and trace
            require a reason.
          </p>
        </header>
        <div className="space-y-3 px-5 py-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="reason"
              className="text-xs font-medium text-muted-foreground"
            >
              Reason (required for Ban + Trace)
            </Label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. ticket #1234 — fraudulent signups"
              maxLength={500}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {isBanned ? (
              <ActionButton
                action="unban"
                pending={pendingAction === "unban"}
                onClick={() => void doAction("unban")}
                icon={CheckCircle2}
              />
            ) : (
              <BanDialog
                pending={pendingAction === "ban"}
                disabled={!reason.trim()}
                reason={reason}
                onConfirm={(banDuration) =>
                  void doAction("ban", { banDuration })
                }
              />
            )}

            {u.traced ? (
              <ActionButton
                action="untrace"
                pending={pendingAction === "untrace"}
                onClick={() => void doAction("untrace")}
                icon={X}
              />
            ) : (
              <ActionButton
                action="trace"
                pending={pendingAction === "trace"}
                disabled={!reason.trim()}
                onClick={() => void doAction("trace")}
                icon={Radio}
              />
            )}

            {u.subscription &&
              u.subscription.status !== "canceled" &&
              !u.subscription.cancelAtPeriodEnd && (
                <ConfirmingActionButton
                  action="cancel_subscription"
                  pending={pendingAction === "cancel_subscription"}
                  onConfirm={() => void doAction("cancel_subscription")}
                  icon={ShieldX}
                  title="Cancel this user's subscription?"
                  description={`Sets cancel-at-period-end on the active Stripe subscription. They keep access until ${u.subscription.currentPeriodEnd ? formatDate(u.subscription.currentPeriodEnd) : "the period end"}, then drop to Free.`}
                />
              )}

            <DeleteUserDialog
              pending={pendingAction === "delete_user"}
              disabled={!reason.trim()}
              email={u.email}
              onConfirm={async () => {
                await doAction("delete_user");
                // The user is gone — navigate back to the list so a
                // refresh-fetch of this page doesn't 404 in a way the
                // operator has to debug.
                router.push("/admin/users");
              }}
            />
          </div>

          <CompAccessPanel
            comp={u.comp}
            pendingGrant={pendingAction === "grant_comp"}
            pendingRevoke={pendingAction === "revoke_comp"}
            reasonProvided={reason.trim().length > 0}
            onGrant={(tier, until) =>
              void doAction("grant_comp", { compTier: tier, compUntil: until })
            }
            onRevoke={() => void doAction("revoke_comp")}
          />
        </div>
      </section>

      {u.traced && <TraceEventsPanel userId={u.id} />}

      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">
            Recent admin actions
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Last 10 audit-log rows for this user.{" "}
            <Link
              href={`/admin/audit?source=app`}
              className="underline-offset-2 hover:underline"
            >
              View full audit log
            </Link>
          </p>
        </header>
        {u.recentActions.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-muted-foreground">
            No prior actions on this user.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {u.recentActions.map((a) => (
              <li
                key={a.id}
                className="px-5 py-3 text-xs"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono">{a.action}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {formatDate(a.created_at)}
                  </span>
                </div>
                {a.payload && (
                  <div className="mt-1.5">
                    <JsonViewer
                      value={a.payload}
                      maxHeight={160}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Refresh into router so other pages that navigated here also
       *  rerender on action commits. Cheap when nothing else is
       *  listening. */}
      {pendingAction === null && reloadKey > 0 && (
        <div className="hidden">
          {router.refresh.length /* keeps router referenced */}
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/users"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to users
    </Link>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-5 py-4">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function ActionButton({
  action,
  pending,
  disabled,
  onClick,
  icon: Icon,
}: {
  action: Action;
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: typeof Ban;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending || disabled}
      className="h-8 gap-1.5"
    >
      <Icon className="h-3.5 w-3.5" />
      {pending ? "Working…" : ACTION_LABELS[action]}
    </Button>
  );
}

function ConfirmingActionButton({
  action,
  pending,
  disabled,
  onConfirm,
  icon: Icon,
  title,
  description,
}: {
  action: Action;
  pending: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  icon: typeof Ban;
  title: string;
  description: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || disabled}
          className="h-8 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
        >
          <Icon className="h-3.5 w-3.5" />
          {pending ? "Working…" : ACTION_LABELS[action]}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              haptic("warning");
              onConfirm();
            }}
            disabled={pending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? "Working…" : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Ban dialog with a duration picker. Separate from
 *  ConfirmingActionButton because it owns local state (the chosen
 *  duration) that the generic confirm-and-call shape can't carry.
 *  Default selection is 7d — long enough to deter the abuse the
 *  operator is reacting to, short enough that a mis-click doesn't
 *  permanently lock out a user without a second human deciding. */
function BanDialog({
  pending,
  disabled,
  reason,
  onConfirm,
}: {
  pending: boolean;
  disabled: boolean;
  reason: string;
  onConfirm: (duration: BanDuration) => void;
}) {
  const [duration, setDuration] = useState<BanDuration>("7d");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || disabled}
          className="h-8 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
        >
          <Ban className="h-3.5 w-3.5" />
          {pending ? "Working…" : ACTION_LABELS.ban}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ban this account?</AlertDialogTitle>
          <AlertDialogDescription>
            This signs the user out and prevents sign-ins for the chosen
            duration. They&apos;ll see a 400 from /login. Reason:{" "}
            {reason || "(none provided)"}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label
            htmlFor="ban-duration"
            className="text-xs font-medium text-muted-foreground"
          >
            Duration
          </Label>
          <select
            id="ban-duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value as BanDuration)}
            disabled={pending}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {(Object.keys(BAN_DURATION_LABELS) as BanDuration[]).map((k) => (
              <option
                key={k}
                value={k}
              >
                {BAN_DURATION_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              haptic("warning");
              onConfirm(duration);
            }}
            disabled={pending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? "Working…" : "Confirm ban"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Destructive delete with type-to-confirm. Mirrors the user-facing
 *  Settings → Delete account UX (paste the email to enable the
 *  button) so an operator who reflexively clicks "Confirm" still
 *  has to think about WHICH account they're erasing. The reason
 *  field on the action panel is also required (the gate is upstream
 *  in the parent component via `disabled`). */
function DeleteUserDialog({
  pending,
  disabled,
  email,
  onConfirm,
}: {
  pending: boolean;
  disabled: boolean;
  email: string | null;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const expected = (email ?? "").trim().toLowerCase();
  const matches = expected !== "" && typed.trim().toLowerCase() === expected;

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) setTyped("");
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || disabled}
          className="h-8 gap-1.5 border-red-500/40 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {pending ? "Working…" : ACTION_LABELS.delete_user}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this user permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            Runs the same cascade as the user&apos;s own &quot;delete
            account&quot; flow: cancels active Stripe subscriptions, removes
            their Storage objects, then deletes the auth row (which cascades
            through every app table). Irreversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label
            htmlFor="delete-confirm"
            className="text-xs font-medium text-muted-foreground"
          >
            Type the user&apos;s email to confirm:{" "}
            <span className="font-mono text-foreground">
              {email ?? "(no email on record)"}
            </span>
          </Label>
          <Input
            id="delete-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={pending || !expected}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              haptic("warning");
              void onConfirm();
            }}
            disabled={pending || !matches}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? "Working…" : "Permanently delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Comp access — grant/revoke a complimentary Plus/Pro tier outside Stripe.
 *  When a grant is active it shows the tier + expiry and a Revoke button;
 *  otherwise a tier picker + optional expiry + Grant. Grant reuses the shared
 *  Reason field above (the route requires it), so the button stays disabled
 *  until a reason is typed — same gate as Ban/Trace. */
function CompAccessPanel({
  comp,
  pendingGrant,
  pendingRevoke,
  reasonProvided,
  onGrant,
  onRevoke,
}: {
  comp: UserDetail["comp"];
  pendingGrant: boolean;
  pendingRevoke: boolean;
  reasonProvided: boolean;
  onGrant: (tier: CompTier, until: string | undefined) => void;
  onRevoke: () => void;
}) {
  const [tier, setTier] = useState<CompTier>("pro");
  const [expiry, setExpiry] = useState(""); // YYYY-MM-DD; "" = indefinite

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <div className="flex items-center gap-1.5">
        <Gift className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Comp access
        </h4>
      </div>
      {comp ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            tone="emerald"
            icon={Gift}
          >
            Comp {comp.tier}
          </Pill>
          <span className="text-xs text-muted-foreground">
            {comp.expiresAt
              ? `until ${formatDate(comp.expiresAt)}`
              : "indefinite — until revoked"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              haptic("warning");
              onRevoke();
            }}
            disabled={pendingRevoke}
            className="h-8 gap-1.5 coarse:h-11"
          >
            <X className="h-3.5 w-3.5" />
            {pendingRevoke ? "Working…" : "Revoke comp"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] text-muted-foreground">
              Tier
            </span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as CompTier)}
              disabled={pendingGrant}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="pro">Pro</option>
              <option value="plus">Plus</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-muted-foreground">
              Expires (optional)
            </span>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              disabled={pendingGrant}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              haptic("success");
              onGrant(tier, expiry ? localEndOfDayIso(expiry) : undefined);
            }}
            disabled={pendingGrant || !reasonProvided}
            className="h-9 gap-1.5 coarse:h-11"
            title={reasonProvided ? undefined : "Enter a reason above first"}
          >
            <Gift className="h-3.5 w-3.5" />
            {pendingGrant ? "Working…" : "Grant comp"}
          </Button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Grants a membership tier without Stripe billing. Takes effect
        immediately; the reason is recorded in the audit log.
      </p>
    </div>
  );
}

/** Turn a `<input type="date">` value (YYYY-MM-DD, the operator's local
 *  calendar day) into the ISO instant at the END of that day in the operator's
 *  LOCAL timezone. Building it as local (not UTC) means "until today" is always
 *  a future instant — so it passes the route's `expiry > now` check — and the
 *  grant lasts through the whole of the day the admin actually picked,
 *  regardless of their offset. */
function localEndOfDayIso(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

type TraceEventRow = {
  id: string;
  created_at: string;
  kind: string;
  method: string | null;
  path: string | null;
  status: number | null;
  duration_ms: number | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: Record<string, unknown> | null;
};

/** "Trace events" panel — renders ONLY when the user is flagged
 *  (`profiles.traced=true`). Pulls the latest captured events
 *  from `/api/admin/users/[id]/trace-events` and shows them
 *  newest-first with per-row affordances:
 *
 *    - HTTP requests show method+path+status (a "GET /api/foo
 *      → 200" line); proxy.ts auto-captures these.
 *    - Error events (from the error reporter) inline-render the
 *      message.
 *    - Any free-form payload expands inline via JsonViewer.
 *
 *  Refresh button rather than auto-poll — the operator pulls
 *  when they want, not on a schedule. A polling timer would
 *  also race other admin panels for screen-real-estate flicker. */
function TraceEventsPanel({ userId }: { userId: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; rows: TraceEventRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void clientFetch(
      `/api/admin/users/${encodeURIComponent(userId)}/trace-events`,
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setState({
            kind: "error",
            message: body.error ?? `HTTP ${res.status}`,
          });
          return;
        }
        const body = (await res.json()) as { rows: TraceEventRow[] };
        setState({ kind: "ok", rows: body.rows });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Network error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  return (
    <section className="overflow-hidden rounded-lg border border-amber-500/30 bg-card">
      <header className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/5 px-5 py-3">
        <div className="flex items-center gap-2">
          <Pill
            tone="amber"
            icon={Radio}
          >
            Tracing active
          </Pill>
          <h3 className="text-sm font-semibold tracking-tight">Trace events</h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setReloadKey((k) => k + 1)}
          className="h-7 text-[11px]"
        >
          Refresh
        </Button>
      </header>

      {state.kind === "loading" ? (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading events…
        </div>
      ) : state.kind === "error" ? (
        <p
          role="alert"
          className="px-5 py-4 text-xs text-red-600"
        >
          {state.message}
        </p>
      ) : state.rows.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No events captured yet"
          description="The user hasn't made any API requests since tracing started. Events will appear here as they happen."
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {state.rows.map((row) => (
            <TraceEventRow
              key={row.id}
              row={row}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TraceEventRow({ row }: { row: TraceEventRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = row.payload && Object.keys(row.payload).length > 0;
  return (
    <li className="px-5 py-3 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={kindTone(row.kind)}>{row.kind}</Pill>
            {row.method && (
              <span className="font-mono text-[11px] font-semibold">
                {row.method}
              </span>
            )}
            {row.path && (
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {row.path}
              </span>
            )}
            {row.status !== null && (
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  row.status >= 500
                    ? "text-red-700 dark:text-red-400"
                    : row.status >= 400
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {row.status}
              </span>
            )}
            {row.duration_ms !== null && (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {row.duration_ms}ms
              </span>
            )}
          </div>
          {row.ip_address && (
            <p className="font-mono text-[10px] text-muted-foreground">
              {row.ip_address}
            </p>
          )}
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatDate(row.created_at)}
        </span>
      </div>
      {hasPayload && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {expanded ? "Hide" : "Show"} payload
          </button>
          {expanded && (
            <div className="mt-1.5">
              <JsonViewer
                value={row.payload}
                maxHeight={200}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function kindTone(
  kind: string,
): "emerald" | "amber" | "red" | "blue" | "muted" {
  if (kind === "http") return "muted";
  if (kind === "error") return "red";
  if (kind === "ai.call") return "blue";
  if (kind.startsWith("admin.")) return "amber";
  return "muted";
}
