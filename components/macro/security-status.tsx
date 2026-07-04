"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Lightweight pub/sub so the Security group's overview card can show an
 *  at-a-glance posture ("Two-step: On · Passkeys: 2 · Backup email: Set …")
 *  WITHOUT re-fetching what each section already loads. Each section reports its
 *  resolved status up via {@link useReportSecurityStatus}; {@link SecurityOverview}
 *  reads them via {@link useSecurityStats}. No provider in the tree = every hook
 *  is an inert no-op, so the sections render unchanged outside the hub. */

export type SecurityStatusKey =
  "twoStep" | "passkeys" | "backupEmail" | "trustedDevices";

export type SecurityTone = "good" | "muted";

export type SecurityStat = {
  /** Short value, e.g. "On", "Off", "2 added", "Set", "Not set". */
  value: string;
  tone: SecurityTone;
};

type ReportFn = (key: SecurityStatusKey, stat: SecurityStat | null) => void;

type Ctx = {
  stats: Partial<Record<SecurityStatusKey, SecurityStat>>;
  report: ReportFn;
};

const SecurityStatusContext = createContext<Ctx | null>(null);

export function SecurityStatusProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<
    Partial<Record<SecurityStatusKey, SecurityStat>>
  >({});

  // Idempotent: a no-op report returns the SAME object so a section re-render
  // can't trigger a provider update loop.
  const report = useCallback<ReportFn>((key, stat) => {
    setStats((prev) => {
      if (stat === null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const cur = prev[key];
      if (cur && cur.value === stat.value && cur.tone === stat.tone) {
        return prev;
      }
      return { ...prev, [key]: stat };
    });
  }, []);

  const value = useMemo(() => ({ stats, report }), [stats, report]);
  return (
    <SecurityStatusContext.Provider value={value}>
      {children}
    </SecurityStatusContext.Provider>
  );
}

const noop: ReportFn = () => {};

/** Sections call the returned fn from an effect when their data resolves.
 *  Safe to call outside a provider (returns a no-op). */
export function useReportSecurityStatus(): ReportFn {
  return useContext(SecurityStatusContext)?.report ?? noop;
}

export function useSecurityStats(): Partial<
  Record<SecurityStatusKey, SecurityStat>
> {
  return useContext(SecurityStatusContext)?.stats ?? {};
}
