/** Typed, validated access to environment variables.
 *
 *  Why this file exists: `process.env.FOO` is stringly-typed and silently
 *  reads `undefined` when the var is missing - which means a missing
 *  `STRIPE_WEBHOOK_SECRET` in prod won't crash on boot; it'll just 500
 *  on the first webhook delivery, hours later. That's the failure mode
 *  AGENTS.md §5.3 explicitly mandates against ("validated at boot, re-
 *  exported as a typed object").
 *
 *  Design notes:
 *
 *    - This module is server-only by convention. The runtime guard
 *      below throws if a client bundle ever imports it. Client code
 *      that needs `NEXT_PUBLIC_*` keys reads `process.env.NEXT_PUBLIC_X`
 *      directly - Next.js inlines those at build time, so there's no
 *      runtime read for them on the client.
 *
 *    - `env` is read once at import and frozen. Re-reading `process.env`
 *      on every access would defeat the typing (env can mutate at
 *      runtime in tests; we want a snapshot).
 *
 *    - `validateEnv()` is intentionally separate from import. Auto-
 *      throwing at import time would break test runners that import
 *      modules transitively while booting their own fixtures. The boot-
 *      time call lives in `instrumentation.ts`. */

if (typeof window !== "undefined") {
  // Fail loud if a client component ever transitively imports this file.
  // Non-public env vars (STRIPE_SECRET_KEY etc.) are stripped from the
  // browser bundle anyway, so the validator would just complain about
  // every key missing - but throwing surfaces the bug at first load
  // instead of leaving the misimport silent.
  throw new Error(
    "lib/env.ts must not be imported from client code - read NEXT_PUBLIC_* directly via process.env.",
  );
}

type NodeEnv = "development" | "test" | "production";

type Env = {
  NODE_ENV: NodeEnv;

  // Public - inlined at build time on the client too.
  NEXT_PUBLIC_APP_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string; // legacy alias for publishable key
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
  NEXT_PUBLIC_ERROR_LOG_DISABLED?: string;

  // Server-only secrets.
  SUPABASE_SECRET_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_AI_PLUS_MONTHLY?: string;
  STRIPE_PRICE_AI_PLUS_YEARLY?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_YEARLY?: string;
  CRON_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  ANTHROPIC_API_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ERROR_LOG_DISABLED?: string;
  SHARE_BADGE_SECRET?: string;
  SOCIAL_TOKEN_SECRET?: string;
  RESEND_WEBHOOK_SECRET?: string;
  // Optional shared cache for Open Food Facts lookups (Upstash Redis REST).
  // Unset = lookups fall through to a direct fetch (fail-open).
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;

  // Vercel-injected (read-only, we don't set these).
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

function readNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === "production" || raw === "test") return raw;
  return "development";
}

function trimmed(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  return t === "" ? undefined : t;
}

function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return Object.freeze({
    NODE_ENV: readNodeEnv(source.NODE_ENV),
    NEXT_PUBLIC_APP_URL: trimmed(source.NEXT_PUBLIC_APP_URL),
    NEXT_PUBLIC_SUPABASE_URL: trimmed(source.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: trimmed(
      source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: trimmed(
      source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: trimmed(source.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    NEXT_PUBLIC_ERROR_LOG_DISABLED: trimmed(
      source.NEXT_PUBLIC_ERROR_LOG_DISABLED,
    ),
    SUPABASE_SECRET_KEY: trimmed(source.SUPABASE_SECRET_KEY),
    STRIPE_SECRET_KEY: trimmed(source.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET: trimmed(source.STRIPE_WEBHOOK_SECRET),
    STRIPE_PRICE_AI_PLUS_MONTHLY: trimmed(source.STRIPE_PRICE_AI_PLUS_MONTHLY),
    STRIPE_PRICE_AI_PLUS_YEARLY: trimmed(source.STRIPE_PRICE_AI_PLUS_YEARLY),
    STRIPE_PRICE_PRO_MONTHLY: trimmed(source.STRIPE_PRICE_PRO_MONTHLY),
    STRIPE_PRICE_PRO_YEARLY: trimmed(source.STRIPE_PRICE_PRO_YEARLY),
    CRON_SECRET: trimmed(source.CRON_SECRET),
    RESEND_API_KEY: trimmed(source.RESEND_API_KEY),
    EMAIL_FROM: trimmed(source.EMAIL_FROM),
    ANTHROPIC_API_KEY: trimmed(source.ANTHROPIC_API_KEY),
    VAPID_PRIVATE_KEY: trimmed(source.VAPID_PRIVATE_KEY),
    VAPID_SUBJECT: trimmed(source.VAPID_SUBJECT),
    ERROR_LOG_DISABLED: trimmed(source.ERROR_LOG_DISABLED),
    SHARE_BADGE_SECRET: trimmed(source.SHARE_BADGE_SECRET),
    SOCIAL_TOKEN_SECRET: trimmed(source.SOCIAL_TOKEN_SECRET),
    RESEND_WEBHOOK_SECRET: trimmed(source.RESEND_WEBHOOK_SECRET),
    UPSTASH_REDIS_REST_URL: trimmed(source.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: trimmed(source.UPSTASH_REDIS_REST_TOKEN),
    VERCEL_URL: trimmed(source.VERCEL_URL),
    VERCEL_PROJECT_PRODUCTION_URL: trimmed(
      source.VERCEL_PROJECT_PRODUCTION_URL,
    ),
  });
}

export const env: Env = readEnv();

/** Severity used by `validateEnv`. `error`s crash the boot in production;
 *  `warn`ings just log. */
export type EnvIssueSeverity = "error" | "warn";

export type EnvIssue = { severity: EnvIssueSeverity; message: string };

/** Validates the current `env` against coherence + format rules.
 *
 *  Returns a list of issues; an empty list means everything checks out.
 *  Separated from `env` itself so tests can drive it with synthetic
 *  inputs via `validateEnvFor()`. */
export function validateEnv(): EnvIssue[] {
  return validateEnvFor(env);
}

/** Same as `validateEnv` but against an arbitrary `Env` snapshot.
 *  Exposed so tests can drive every branch without monkey-patching
 *  `process.env`. */
export function validateEnvFor(e: Env): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const err = (message: string) => issues.push({ severity: "error", message });
  const warn = (message: string) => issues.push({ severity: "warn", message });

  // --- Format checks (apply whenever the key is set) ---

  if (e.STRIPE_SECRET_KEY && !/^sk_(test|live)_/.test(e.STRIPE_SECRET_KEY)) {
    err("STRIPE_SECRET_KEY must start with `sk_test_` or `sk_live_`.");
  }
  if (
    e.STRIPE_WEBHOOK_SECRET &&
    !e.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")
  ) {
    err("STRIPE_WEBHOOK_SECRET must start with `whsec_`.");
  }
  if (e.NEXT_PUBLIC_APP_URL && !/^https?:\/\//.test(e.NEXT_PUBLIC_APP_URL)) {
    err("NEXT_PUBLIC_APP_URL must be an absolute http(s) URL.");
  }
  if (
    e.NEXT_PUBLIC_SUPABASE_URL &&
    !/^https?:\/\//.test(e.NEXT_PUBLIC_SUPABASE_URL)
  ) {
    err("NEXT_PUBLIC_SUPABASE_URL must be an absolute http(s) URL.");
  }
  if (
    e.EMAIL_FROM &&
    !/^[^@\s<]+@[^@\s>]+$|<[^@\s>]+@[^@\s>]+>/.test(e.EMAIL_FROM)
  ) {
    // Accept both `user@host` and `Name <user@host>` forms.
    err("EMAIL_FROM must be a valid email or `Name <email>` address.");
  }
  if (e.VAPID_SUBJECT && !/^(mailto:|https?:\/\/)/.test(e.VAPID_SUBJECT)) {
    err("VAPID_SUBJECT must start with `mailto:` or be a URL.");
  }
  if (e.SHARE_BADGE_SECRET && e.SHARE_BADGE_SECRET.length < 32) {
    err(
      "SHARE_BADGE_SECRET must be at least 32 characters (HMAC-SHA256 needs real entropy).",
    );
  }
  if (e.SOCIAL_TOKEN_SECRET && e.SOCIAL_TOKEN_SECRET.length < 32) {
    err(
      "SOCIAL_TOKEN_SECRET must be at least 32 characters (it keys AES-256 for stored OAuth tokens).",
    );
  }
  if (
    e.UPSTASH_REDIS_REST_URL &&
    !e.UPSTASH_REDIS_REST_URL.startsWith("https://")
  ) {
    warn(
      "UPSTASH_REDIS_REST_URL should be the https:// REST endpoint (the Upstash REST API, not a redis:// connection string).",
    );
  }

  // --- Coherence: features that require multiple keys to work ---

  if (e.STRIPE_SECRET_KEY && !e.STRIPE_WEBHOOK_SECRET) {
    err(
      "STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing - webhook deliveries will fail signature verification.",
    );
  }
  if (e.STRIPE_WEBHOOK_SECRET && !e.STRIPE_SECRET_KEY) {
    err(
      "STRIPE_WEBHOOK_SECRET is set but STRIPE_SECRET_KEY is missing - webhook handler can't enqueue follow-up Stripe API calls.",
    );
  }

  const vapidParts = [
    e.VAPID_PRIVATE_KEY,
    e.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    e.VAPID_SUBJECT,
  ];
  const vapidSet = vapidParts.filter(Boolean).length;
  if (vapidSet > 0 && vapidSet < 3) {
    err(
      "VAPID config is partial - set all of VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_SUBJECT, or none.",
    );
  }

  if (e.RESEND_API_KEY && !e.EMAIL_FROM) {
    err(
      "RESEND_API_KEY is set but EMAIL_FROM is missing - every email send would 400 before leaving the server.",
    );
  }

  if (e.UPSTASH_REDIS_REST_URL && !e.UPSTASH_REDIS_REST_TOKEN) {
    err(
      "UPSTASH_REDIS_REST_URL is set but UPSTASH_REDIS_REST_TOKEN is missing - the OFF cache can't authenticate, so every lookup would fall through to a direct fetch.",
    );
  }
  if (e.UPSTASH_REDIS_REST_TOKEN && !e.UPSTASH_REDIS_REST_URL) {
    err(
      "UPSTASH_REDIS_REST_TOKEN is set but UPSTASH_REDIS_REST_URL is missing.",
    );
  }

  // --- Production-only requirements ---

  if (e.NODE_ENV === "production") {
    if (!e.NEXT_PUBLIC_SUPABASE_URL) {
      err("Production deploys require NEXT_PUBLIC_SUPABASE_URL.");
    }
    if (
      !e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
      !e.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      err(
        "Production deploys require NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY).",
      );
    }
    if (!e.SUPABASE_SECRET_KEY) {
      warn(
        "SUPABASE_SECRET_KEY missing in production - admin features (account delete, cron jobs) will return 503.",
      );
    }
    if (!e.CRON_SECRET) {
      warn(
        "CRON_SECRET missing in production - cron routes will accept no callers, so daily reminders, retention, and trial-ending emails will not run.",
      );
    }
    if (!e.NEXT_PUBLIC_APP_URL && !e.VERCEL_PROJECT_PRODUCTION_URL) {
      warn(
        "Neither NEXT_PUBLIC_APP_URL nor VERCEL_PROJECT_PRODUCTION_URL is set - email links may point at per-deployment Vercel aliases.",
      );
    }
  }

  return issues;
}

/** Convenience for `instrumentation.ts` and tests: returns a human-
 *  readable multi-line summary, suitable for console output or
 *  `throw new Error()`. */
export function formatEnvIssues(issues: EnvIssue[]): string {
  if (issues.length === 0) return "Env validation passed.";
  const lines = issues.map(
    (i) => `  [${i.severity === "error" ? "ERROR" : "warn"}] ${i.message}`,
  );
  return `Env validation found ${issues.length} issue(s):\n${lines.join("\n")}`;
}
