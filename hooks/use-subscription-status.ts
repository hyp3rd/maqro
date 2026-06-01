"use client";

import { useEffect, useState } from "react";

/** Thin sibling to `useAiUsage` that reads only the subscription
 *  status from `/api/billing/usage`. We could repurpose `useAiUsage`
 *  itself, but the banner consumers don't care about AI quotas and
 *  shouldn't trigger a re-render every time the AI counter ticks.
 *
 *  Why a dedicated hook over an inline fetch: gives banner + Settings
 *  the same source of truth without two fetches, and the visibility-
 *  change refresh is shared (a user updating their card in Stripe
 *  portal expects the banner to disappear when they return to the
 *  app tab). */

export type SubscriptionStatus =
  | { kind: "loading" }
  | { kind: "anon" }
  // Catalog of statuses we render UI for. `unknown` covers any
  // future Stripe status we don't recognize — the route always
  // returns the raw value, but the UI only branches on the ones
  // it has copy for.
  | { kind: "known"; status: KnownStatus }
  | { kind: "unknown"; raw: string | null }
  | { kind: "error"; message: string };

export type KnownStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | null;

const KNOWN: ReadonlySet<NonNullable<KnownStatus>> = new Set([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
]);

function toState(raw: string | null | undefined): SubscriptionStatus {
  if (raw == null) return { kind: "known", status: null };
  return KNOWN.has(raw as NonNullable<KnownStatus>)
    ? { kind: "known", status: raw as KnownStatus }
    : { kind: "unknown", raw };
}

export function useSubscriptionStatus(): SubscriptionStatus {
  const [state, setState] = useState<SubscriptionStatus>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/usage")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({ kind: "anon" });
          return;
        }
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
        const body = (await res.json()) as {
          subscriptionStatus?: string | null;
        };
        setState(toState(body.subscriptionStatus));
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  // Refresh on tab focus — common path: user clicks the banner CTA,
  // updates their card in Stripe portal (different tab), returns to
  // the app. The banner should disappear on the visibility-change
  // re-fetch without requiring a full page reload.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return state;
}
