import { after } from "next/server";
import { Redis } from "@upstash/redis";

/** Optional, cross-instance JSON cache backed by Upstash Redis (the serverless
 *  REST client — no connection pooling, safe in Vercel's Node runtime).
 *
 *  Entirely optional: with `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
 *  unset the accessor resolves to `null` and every read/write is a no-op, so
 *  callers transparently fall through to their origin fetch (fail-open). The
 *  same fail-open applies to ANY runtime Redis error — a cache outage must
 *  never break (or slow) a lookup. Mirrors the optional-integration shape of
 *  `getAnthropicConfig` (`lib/ai/env.ts`) and the fire-and-forget-never-throws
 *  style of `recordTraceEvent` (`lib/admin-trace.ts`). */

// `undefined` = not yet resolved; `null` = resolved-as-unconfigured. Memoized so
// the REST client is constructed at most once per server process.
let client: Redis | null | undefined;

function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Both-or-nothing — a half-configured pair can't authenticate, so treat it
  // as unconfigured (the boot-time `validateEnvFor` check surfaces the misconfig).
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/** Read a JSON value from the cache. Returns `null` when the cache is
 *  unconfigured OR on any error (fail-open) — the caller then fetches from the
 *  origin. `@upstash/redis` deserializes JSON for us, so the value is already
 *  parsed.
 *
 *  Contract: callers distinguish a hit from a miss with `if (value)`, so only
 *  store TRUTHY values. A legitimately-cacheable falsy value (`0`, `""`,
 *  `false`) would be read back as a miss — wrap it in an object/array first. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<T>(key)) ?? null;
  } catch (err) {
    // A cache read failure is non-fatal; log the key (never the credentials)
    // and fall through to the origin.
    console.warn("[cache] get failed for %s:", key, err);
    return null;
  }
}

/** Write a value with a TTL — write-through, off the response's critical path so
 *  a slow (or failing) Redis PUT never adds latency to, or breaks, the response
 *  that triggered it.
 *
 *  The write is handed to `after()` so it runs AFTER the response is sent while
 *  keeping the serverless function alive until it completes — without this, a
 *  Vercel function can be frozen the instant the response returns and the
 *  un-awaited PUT is dropped, so the cache would never populate in production.
 *  Outside a request scope (unit tests, non-request callers) `after()` throws;
 *  there we fall back to a detached fire-and-forget. */
export function cacheSetFireAndForget(
  key: string,
  value: unknown,
  ttlSeconds: number,
): void {
  const redis = getRedis();
  if (!redis) return;
  const write = () =>
    redis.set(key, value, { ex: ttlSeconds }).catch((err) => {
      console.warn("[cache] set failed for %s:", key, err);
    });
  try {
    after(write);
  } catch {
    void write();
  }
}

/** Test-only: drop the memoized client so a test can toggle the env vars and
 *  re-resolve. Mirrors `_clearSettingsCacheForTests` in `lib/app-settings.ts`. */
export function _resetRedisClientForTests(): void {
  client = undefined;
}
