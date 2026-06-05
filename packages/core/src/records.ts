import type { Meal } from "./types";

/** Persisted-record domain types — the shapes stored locally (IndexedDB) and
 *  synced to Supabase. Pure types, shared with the native app; the web storage
 *  layer (`@/lib/db`) re-exports them so existing imports are unchanged. */

/** Sync-engine metadata mixed into every persisted record. Optional so plain
 *  object literals (forms, mappers, tests) don't have to know about sync
 *  internals — the storage layer fills them in, and the sync engine treats
 *  missing / null as "never synced". */
export type Versioned = {
  localUpdatedAt?: string;
  serverUpdatedAt?: string | null;
};

/** A single day's meal log, keyed by `YYYY-MM-DD` in the user's local
 *  timezone. The `meals` shape mirrors the in-memory `Meal[]` exactly. */
export type DailyLog = {
  date: string;
  meals: Meal[];
  /** Legacy ms-epoch timestamp from pre-v7 rows. Kept for backwards
   *  compatibility while migrating; new writes set the `Versioned` fields. */
  updatedAt: number;
} & Versioned;

/** A single weigh-in, keyed by `YYYY-MM-DD` local date — same-day writes
 *  overwrite, so the latest weigh-in for a day wins. */
export type WeightEntry = {
  date: string;
  kg: number;
  recordedAt: number;
} & Versioned;
