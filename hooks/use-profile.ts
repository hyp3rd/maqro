"use client";

import type { PersonalInfo } from "@/components/macro/types";
import { getProfile, saveProfile, saveWeightEntry, todayKey } from "@/lib/db";
import { notifyProfileChanged } from "@/lib/profile-bus";
import { reportStorageError, reportStorageOk } from "@/lib/storage-status";
import { bumpPending } from "@/lib/sync-status";
import { useDataRev } from "@/lib/sync/data-bus";
import { detectDefaultUnitSystem } from "@/lib/units";
import { useCallback, useEffect, useRef, useState } from "react";

const WRITE_DEBOUNCE_MS = 500;

export type ProfileState = {
  profile: PersonalInfo;
  setProfile: (next: PersonalInfo) => void;
  /** Patch a single field. Equivalent to `setProfile({ ...profile, [name]: value })`. */
  patchProfile: (
    name: keyof PersonalInfo,
    value: PersonalInfo[keyof PersonalInfo],
  ) => void;
  /** False on first render; true once IndexedDB has resolved. */
  isHydrated: boolean;
};

/** Persists the user's profile in IndexedDB. On mount, attempts to load
 * the saved profile; falls back to `defaultProfile` if none exists or
 * IndexedDB is unavailable (e.g. private mode, SSR). Writes are debounced
 * so a stream of input-change events doesn't hammer the store. */
export function useProfile(defaultProfile: PersonalInfo): ProfileState {
  const [profile, setProfileState] = useState<PersonalInfo>(defaultProfile);
  const [isHydrated, setIsHydrated] = useState(false);
  // Tracks the last weight we've persisted as a weigh-in. `null` until
  // hydration completes; thereafter, updates fire a weighHistory entry
  // for today only when the weight value itself changes (so editing other
  // profile fields doesn't create phantom data points).
  const lastWeighedKg = useRef<number | null>(null);
  // Bumped by the sync data-bus whenever the realtime layer writes a
  // fresh profile into IDB (typically from another device). Including
  // it in the load effect's dep array re-runs the load and pulls the
  // new value into React state without needing a page refresh.
  const profileRev = useDataRev("profile");
  // Gate the auto-save on a *real* user edit. Without it, a fresh
  // session (incognito window, freshly cleared IDB) would auto-save
  // the synthetic `defaultProfile` to IDB before the initial sync
  // runs, and the first push would upload those defaults - clobbering
  // the user's real profile on the server. Set to true only by the
  // setProfile / patchProfile callbacks below; the load effect bumps
  // it implicitly by writing back whatever it loaded from IDB (a
  // saved row from a prior session) - that's the "an actual profile
  // exists" signal.
  const hasRealLocalData = useRef(false);
  // Refs holding the LATEST debounced write that hasn't been flushed
  // to IDB yet. Used by the unmount-only effect at the bottom to fire
  // the writes synchronously when the component is torn down. Without
  // this, a fast sign-out (edit weight → click Sync → click Sign out
  // within the 500ms debounce window) loses the writes because the
  // debounced setTimeout is cleared by the cleanup function and IDB
  // never sees the change. The result: the user's "today" weigh-in is
  // silently dropped while past-date entries (which save without a
  // debounce via the LogWeight form) are preserved.
  const pendingProfileRef = useRef<PersonalInfo | null>(null);
  const pendingWeightRef = useRef<number | null>(null);
  // The weight the user explicitly entered THIS session via the
  // setProfile/patchProfile setters. `null` between user edits.
  // The auto-capture effect reads this - not raw `profile.weight`
  // - so realtime / load-path mutations of `profile.weight` never
  // turn into phantom weigh-in writes.
  const userIntendedWeight = useRef<number | null>(null);

  // Load on mount and on every realtime arrival.
  useEffect(() => {
    let cancelled = false;
    // Locale-aware default for the `units` preference. The module-
    // level `defaultProfile` can't read `navigator` (SSR) so it
    // hard-codes "metric"; here we upgrade to "imperial" for US /
    // Liberia / Myanmar locales before the first paint of the
    // user's data. Only applied when the loaded row predates the
    // units field OR when there's no loaded row at all (first
    // run). An explicit user choice always wins on subsequent
    // loads.
    const localeDefault = detectDefaultUnitSystem();
    getProfile()
      .then((loaded) => {
        if (cancelled) return;
        // Merge defaults *behind* the loaded record so new fields added in
        // later schema versions (e.g. dietPreference) get a sane value when
        // an existing IDB / Supabase profile lacks them.
        if (loaded) {
          const withUnits: PersonalInfo = {
            ...defaultProfile,
            ...loaded,
            // Legacy migration: rows persisted before the units
            // feature have no `units` field. Treat that as "never
            // chose explicitly" and apply the locale default.
            units: loaded.units ?? localeDefault,
          };
          setProfileState(withUnits);
          // We loaded a real row from IDB - auto-saves are now safe.
          hasRealLocalData.current = true;
        } else {
          // First-ever run — no IDB row exists. Patch the in-memory
          // state with the locale default so a US user lands on
          // pounds instead of having to flip Settings.
          setProfileState((prev) => ({ ...prev, units: localeDefault }));
        }
        setIsHydrated(true);
      })
      .catch((err) => {
        // IndexedDB unavailable - proceed with the in-memory default but
        // surface the failure so the user knows their changes won't stick.
        reportStorageError(err);
        if (!cancelled) setIsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [defaultProfile, profileRev]);

  // Debounced write. Gated on `isHydrated` (so we don't write before
  // load resolves) and on `hasRealLocalData` (so a fresh session that
  // had nothing to load doesn't write synthetic defaults to IDB - see
  // the ref's declaration for the data-loss scenario this guards).
  useEffect(() => {
    if (!isHydrated) return;
    if (!hasRealLocalData.current) return;
    pendingProfileRef.current = profile;
    const t = window.setTimeout(() => {
      saveProfile(profile)
        .then(() => {
          pendingProfileRef.current = null;
          reportStorageOk();
          // Tell other components (the sidebar UserMenu, primarily) that
          // the profile they may be reading independently from IDB has a
          // fresh value to pick up.
          notifyProfileChanged();
        })
        .catch(reportStorageError);
    }, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [profile, isHydrated]);

  // Auto-capture USER-INITIATED weight changes into the
  // weightHistory store. Driven by the `userIntendedWeight` ref -
  // not `profile.weight` directly - so a profile mutation that
  // comes from the load/sync path doesn't trigger a phantom
  // weigh-in for TODAY using yesterday's stale value.
  //
  // Bug-history: an earlier version watched `profile.weight` via
  // useEffect, treating EVERY change as a user edit. When a
  // realtime profile pull or a second-load arrival brought a
  // pre-edit value back into state, the effect dutifully wrote
  // that stale value into TODAY's weightHistory row - overwriting
  // a fresh weigh-in the user had just made. The
  // `userIntendedWeight` ref isolates the "user typed a new
  // weight" signal from "some sync layer mutated profile state".
  useEffect(() => {
    if (!isHydrated) return;
    const target = userIntendedWeight.current;
    if (target === null) return;
    if (target === lastWeighedKg.current) {
      userIntendedWeight.current = null;
      return;
    }
    pendingWeightRef.current = target;
    const t = window.setTimeout(() => {
      saveWeightEntry(todayKey(), target)
        .then(() => {
          lastWeighedKg.current = target;
          pendingWeightRef.current = null;
          userIntendedWeight.current = null;
          bumpPending();
        })
        .catch(reportStorageError);
    }, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [profile.weight, isHydrated]);

  // Track the last value the LOAD path pushed into profile.weight
  // so the user-edit setters below can detect "this is a real
  // user change" (target !== loaded value) vs "this is a no-op
  // setter call from a sync-induced re-render".
  useEffect(() => {
    if (isHydrated && userIntendedWeight.current === null) {
      lastWeighedKg.current = profile.weight;
    }
  }, [profile.weight, isHydrated]);

  // Flush-on-unmount. Empty deps so the cleanup runs once when the
  // component is torn down - fires any pending debounced write
  // directly to IDB without awaiting. IDB persists across the React
  // lifecycle so the write completes even after the component is
  // gone. Without this, a fast sign-out (or any other quick unmount
  // path) within the 500ms debounce window silently drops the user's
  // most recent profile edit AND the today-weigh-in derived from it.
  useEffect(() => {
    return () => {
      const profileToSave = pendingProfileRef.current;
      if (profileToSave) {
        void saveProfile(profileToSave).catch(reportStorageError);
        pendingProfileRef.current = null;
      }
      const weightToSave = pendingWeightRef.current;
      if (weightToSave !== null) {
        void saveWeightEntry(todayKey(), weightToSave).catch(
          reportStorageError,
        );
        pendingWeightRef.current = null;
      }
    };
  }, []);

  // Public setters - bump the sync-pending counter so the topbar pill
  // can signal "you have local changes." Internal hydration uses
  // setProfileState directly to avoid spurious pending signals. Both
  // setters flip `hasRealLocalData` so subsequent saves are allowed
  // even on a fresh session where nothing was loaded from IDB - the
  // user has explicitly produced real data.
  const setProfile = useCallback((next: PersonalInfo) => {
    hasRealLocalData.current = true;
    bumpPending();
    // Flag the new weight for the auto-capture effect. Only the
    // user-edit path goes through here; the sync/load path uses
    // setProfileState directly and intentionally bypasses this.
    if (typeof next.weight === "number") {
      userIntendedWeight.current = next.weight;
    }
    setProfileState(next);
  }, []);

  const patchProfile = useCallback(
    (name: keyof PersonalInfo, value: PersonalInfo[keyof PersonalInfo]) => {
      hasRealLocalData.current = true;
      bumpPending();
      if (name === "weight" && typeof value === "number") {
        userIntendedWeight.current = value;
      }
      setProfileState((prev) => ({ ...prev, [name]: value }));
    },
    [],
  );

  return { profile, setProfile, patchProfile, isHydrated };
}
