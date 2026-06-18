# Contributing to Maqro

Thanks for being interested. This guide is the operating manual for
both humans and AI coding agents working in this repository — read it
before opening a PR.

The short version: **smallest correct change, root-cause fixes,
every gate green before you call it done, push back when something
looks wrong**. The long version is below.

---

## 1. Prime directives

These are non-negotiable.

1. **Solve the root cause. Never paper over it.**
   No workarounds, no `// eslint-disable`, no `@ts-expect-error`, no
   `@ts-ignore`, no `try { ... } catch { /* ignore */ }`, no
   swallowing errors. If the right fix is bigger than the symptom,
   say so in the PR and we'll scope the bigger change — but do not
   silently route around it.

1. **Verify before you write.**
   Next.js, Supabase, Stripe, and Anthropic ship breaking changes
   regularly. Before using anything non-trivial, confirm the
   **current stable version** in `package.json` and read the
   official docs for that version. Training-data answers age fast;
   docs are authoritative. Cite the version / changelog you
   consulted in the PR description when it matters.

1. **Be critical. Push back.**
   If a request is ambiguous, contradicts existing code, or has a
   better alternative, say so before producing code. A five-line
   clarifying question is cheaper than a 500-line wrong patch. We
   prefer a critical, honest contributor over an obedient one.

1. **Stay on task.**
   Ship the smallest correct diff that satisfies the request. No
   drive-by refactors, no formatting cleanups in untouched files,
   no renaming unrelated symbols, no "while I'm here" expansions.
   If you spot something worth doing, file it as a follow-up issue
   or PR — do not bundle it.

1. **Optimal abstraction. DRY ruthlessly — but not prematurely.**
   Duplication that has appeared three times in materially the
   same shape gets abstracted. Duplication that has appeared once
   stays inline. Wrong abstractions are more expensive than
   duplication; if a shared helper requires special-case flags for
   each caller, it is the wrong abstraction — inline it.

1. **All quality gates pass before you declare done.**
   See [§5 Quality gates](#5-quality-gates). "Works on my machine"
   is not done. "Tests pass but lint fails" is not done. Done means
   every gate is green.

---

## 2. The working loop

Every task follows this loop. Skipping a step is a defect.

1. **Understand** — read the request, the surrounding code, and the
   relevant tests. State your understanding back if any ambiguity
   remains.
1. **Verify** — confirm the versions of libraries you'll touch and
   read the current docs for unfamiliar APIs.
1. **Plan** — outline the change before writing it. For non-trivial
   changes, share the plan first.
1. **Implement** — smallest correct diff. Match the conventions of
   the file/package you're editing.
1. **Test** — add or update tests for the behavior you changed.
   New behavior without a test is incomplete.
1. **Gate** — run every target in [§5 Quality gates](#5-quality-gates)
   locally. Fix until green. Never disable a check to make it pass.
1. **Report** — summarize what changed, why, what you verified, and
   any follow-ups you deliberately did not do.

---

## 3. Local development

```bash
nvm use            # Node 25 from .nvmrc
npm install
cp .env.local.example .env.local   # configure as needed
npm run dev        # http://localhost:3000
```

Without `.env.local` the app runs in **guest mode** with everything
in IndexedDB. See [Configuration](docs/configuration.md)
for every env var. The vast majority are optional — unset → the
feature disables gracefully.

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Dev server with Turbopack               |
| `npm run build`      | Production build                        |
| `npm run start`      | Serve the production build              |
| `npm run lint`       | ESLint                                  |
| `npm run typecheck`  | `tsc --noEmit`                          |
| `npm test`           | Vitest run-once                         |
| `npm run test:watch` | Vitest watch                            |
| `npm run e2e`        | Playwright (auto-starts the dev server) |
| `npm run format`     | Prettier write                          |
| `npm run db:push`    | Apply pending Supabase migrations       |
| `npm run db:new`     | Scaffold a new migration                |

---

## 4. Repository layout

A high-level map. See [Architecture](docs/architecture.md)
for the comprehensive file tree.

| Path                    | What lives here                                                |
| ----------------------- | -------------------------------------------------------------- |
| `app/`                  | Next.js App Router — pages, API routes, error boundaries       |
| `components/macro/`     | Feature components (Calculator, Plan, Progress, Recipes, …)    |
| `components/shell/`     | App chrome (Sidebar, Topbar, AppShell, InstallPrompt, …)       |
| `components/ui/`        | shadcn primitives (Button, Input, Dialog, …)                   |
| `hooks/`                | Client hooks (`use-user`, `use-today`, `use-version-check`, …) |
| `lib/`                  | Pure logic + IO modules (testable in isolation)                |
| `lib/ai/`               | Anthropic SDK wrappers + prompt builders + validators          |
| `lib/billing/`          | Stripe client + tier resolution + usage metering               |
| `lib/sync/`             | IndexedDB ↔ Supabase reconciler                                |
| `lib/supabase/`         | Auth client + server + cookie proxy                            |
| `lib/email/`            | Resend wrapper + templates                                     |
| `supabase/migrations/`  | Idempotent SQL migrations                                      |
| `data/food-database.ts` | Built-in food catalog                                          |
| `public/`               | Static assets, `sw.js`, `offline.html`                         |
| `tests/e2e/`            | Playwright specs                                               |

---

## 5. Quality gates

Before declaring any task done, the following must be green:

```bash
npm run lint        # ESLint — zero warnings, not just zero errors
npm run typecheck   # tsc --noEmit
npm test            # Vitest run-once (423 tests, ~5 s)
npm run build       # Production build
```

Or use the wrapper:

```bash
make ci             # runs all of the above
```

**Rules of engagement:**

- A failing gate is **never** silenced with an inline directive
  (`// eslint-disable`, `// @ts-ignore`, `@ts-expect-error`,
  `it.skip`, `xtest`). If a rule is genuinely wrong for the
  codebase, change its configuration in a separate, justified
  commit — but don't paper over it inline.
- If a check is missing for a language or surface present in the
  repo (e.g. an untested route), **add the check** — don't ship
  without coverage.
- Hooks (Git pre-commit, CI workflow) are never bypassed with
  `--no-verify`. If a hook is failing, fix the underlying issue.

---

## 6. TypeScript rules

The repo is `strict: true`. Don't weaken the type system.

- **No `any`.** Use `unknown` and narrow with a type guard. `any`
  hides the bug instead of fixing it.
- **No `@ts-ignore`.** If you genuinely need to escape, use
  `@ts-expect-error` with a comment explaining why and a condition
  for removing it. Both forms require justification in the PR.
- **Type at the boundaries.** Function signatures, exported helpers,
  React props, and route handlers should have explicit types. Inside
  small local helpers, inference is fine.
- **Discriminated unions over optional fields.** A function that
  sometimes returns `{ ok: true; data: T }` and sometimes
  `{ ok: false; error: E }` is much safer than one that returns
  `{ data?: T; error?: E }`.
- **No type casts to shut up the compiler.** `x as Foo` is a code
  smell unless `x` literally crossed a JSON or DOM boundary. Prefer
  narrowing.
- **Schema-validate external input.** Anything from `req.json()`,
  `process.env`, or third-party API responses needs explicit
  shape-checking before you trust it. We don't enforce a specific
  library (no zod dep today), so hand-write the validator — see
  `app/api/errors/route.ts` for the pattern.

---

## 7. React + Next.js 16 rules

The repo uses the **App Router**. The Pages Router does not exist
here.

- **Server Components by default.** Add `"use client"` only when
  you need React state/effects, browser APIs, or interactivity.
  Most data fetching belongs in a Server Component or a Route
  Handler, not on the client.
- **Route Handlers (`route.ts`)** are the canonical way to expose
  HTTP endpoints. Validate the body, check auth (`requireAdmin`
  for `/api/admin/*`), return `NextResponse.json(...)`.
- **Forms via Server Actions** where they fit naturally; typed
  Route Handlers otherwise. We have a mix today.
- **Caching is an explicit decision.** Next 16 changed caching
  defaults more than once — read the current docs for
  `force-dynamic`, `revalidate`, and `dynamic` before changing
  them. Examples: `/api/version` is `force-dynamic` + `no-store`
  on purpose; `/api/off-search` uses `s-maxage=60` on purpose.
- **Environment variables** validated at the boundary, not
  scattered through the code. See `lib/supabase/env.ts` and
  `lib/billing/stripe.ts` for the pattern.
- **The `react-hooks/set-state-in-effect` lint rule is enforced.**
  Don't call `setState` synchronously inside `useEffect`. Use lazy
  state initializers, the "reset state during render" pattern, or
  derive the value with `useMemo`. See `components/shell/UpdateBanner.tsx`
  for examples.
- **Next.js 16 renames `middleware.ts` to `proxy.ts`.** We have
  both: `proxy.ts` (Supabase cookie refresh) and `middleware.ts`
  may also appear for admin route gating. Keep them separated by
  concern.

---

## 8. Code conventions

- **Naming.** `camelCase` for variables / functions, `PascalCase`
  for types / React components, `SCREAMING_SNAKE` for module-level
  constants, `kebab-case` for file names.
- **Comments only when the _why_ is non-obvious.** Identifiers say
  what; comments are for hidden invariants, workarounds, surprising
  constraints. Don't narrate the code. Don't reference the current
  PR or issue ID inside the comment — that belongs in the PR
  description.
- **Error handling.** No silent catches. Either re-throw with
  context (wrap the original message so the trace stays useful),
  show a user-visible toast / state, or log loudly to stderr. For
  client-side errors that escape React's boundaries, the global
  error handler in `components/shell/GlobalErrorHandler.tsx` will
  report them via `lib/error-reporter.ts`.
- **No premature abstraction.** Three lines duplicated twice is
  better than the wrong abstraction. Wait for the third occurrence.
- **No new dependencies without justification.** Three lines of
  stdlib beats a 500-KB package. If you need to add one, mention
  the alternative you considered in the PR.

---

## 9. Testing

**423 unit tests across 39 files.** Patterns to follow:

- **Pure logic** in `lib/` gets a sibling `.test.ts`. Examples:
  `lib/macros.test.ts`, `lib/trends.test.ts`,
  `lib/billing/tiers.test.ts`. No mocking required.
- **React hooks** in `hooks/` get a sibling `.test.ts` with
  `@vitest-environment jsdom` and `renderHook` from
  `@testing-library/react`. Examples: `hooks/use-today.test.ts`,
  `hooks/use-version-check.test.ts`. Use `vi.useFakeTimers()` for
  anything time-sensitive.
- **Route handlers** that integrate Anthropic / Supabase / Stripe
  get a scripted-SDK integration test. Mock the SDK with `vi.mock`,
  drive a scripted reply, assert the right side effects.
  Examples: `app/api/meal-plan/route.test.ts`,
  `app/api/recipes/generate/route.test.ts`.
- **UI behavior** lives in `tests/e2e/*.spec.ts` (Playwright). New
  E2E tests are rare — reach for them when the user-visible flow
  can only be exercised end-to-end (sign-in cycle, sync pill,
  install banner). Most behavior should be covered by unit + hook
  tests.

What to test:

- The **happy path** and at least one **failure path** per behavior.
- **Edge cases** that aren't obvious from the function signature —
  empty inputs, single-element inputs, off-by-one boundaries, and
  the timezone / DST / leap-year case if you're touching dates.
- The **invariant** rather than the implementation. A test that
  pins down internal state instead of behavior is brittle and
  breaks the next refactor.

What NOT to test:

- Framework behavior (don't test that `useState` works).
- Third-party SDKs (mock them at the boundary).
- Visual styling (Playwright snapshots are off the table — too
  flaky given how often we tune visuals).

---

## 10. Database migrations

We use the bundled Supabase CLI. Migrations are in
`supabase/migrations/NNNN_<name>.sql`.

```bash
npm run db:new <descriptive_name>   # scaffolds the next-numbered file
# Edit the SQL...
npm run db:push                     # applies pending migrations to the linked project
npm run db:status                   # shows what's been applied
```

**Rules of the road:**

- **Idempotent.** Production runs them more than once (CI dry-run,
  cron, hot-fix re-applies). Use `create table if not exists`,
  `alter table ... add column if not exists`, `drop policy if
exists` + `create policy`. See `0014_welcome_sent_at.sql` for
  the minimal example or `0011_ai_usage.sql` for a full one.
- **No data loss without explicit user opt-in.** Don't drop columns
  or tables in the same migration that adds the replacement. Use
  the standard add-new + backfill + (next release) drop-old
  two-step.
- **Document the _why_.** Open the file with a header comment
  explaining what the change unlocks and any non-obvious choices
  (cascade direction, partial-index predicates, etc.). See
  `0015_error_log.sql` and `0017_tiered_billing.sql` for the
  format.
- **PG-15 compatible.** Production may run an older Postgres than
  your local dev DB. `create policy if not exists` is PG-16 only —
  use `drop policy if exists` + `create policy` instead.

The GitHub Actions workflow at
[`.github/workflows/supabase-migrations.yml`](.github/workflows/supabase-migrations.yml)
runs `supabase migration list` (dry run) on every PR that touches
`supabase/`, and `supabase db push` on merges to `main`.

---

## 11. Security + secrets

- **Never log, print, or commit** secrets, tokens, customer data,
  or anything from `.env*`. Pre-commit hooks try to catch this but
  the responsibility is the contributor's.
- **Validate all external input at the boundary** — HTTP handlers,
  cron handlers, webhook handlers, anything that crosses a trust
  edge. See `app/api/billing/webhook/route.ts` for the canonical
  pattern (signature verify → schema check → idempotency gate →
  state mutation).
- **SQL: parameterized queries only.** Every database access goes
  through Supabase's PostgREST client (`from(...).eq(...).select(...)`).
  No string interpolation, no `rpc()` with user-controlled SQL.
- **Stripe webhook signature verification is mandatory.** A skipped
  `constructEvent` call is a critical bug.
- **Service-role key stays server-side.** Never imported from a
  file under `components/` or `hooks/`. The build doesn't enforce
  this — code review does.
- **Run `npm audit` and Supabase advisor periodically.** They're
  not in the gates yet but they should be green.

If you've found a vulnerability, **do not open a public issue.**
See [`SECURITY.md`](SECURITY.md).

---

## 12. Forbidden patterns (hard stops)

If you find yourself reaching for any of these, stop and reconsider.

- Editing generated files by hand instead of regenerating them
  (e.g. `supabase/migrations/*` that were scaffolded and then
  pasted-over; use `db:new` and pick up where it left off).
- `setTimeout` with arbitrary delays to "fix" race conditions —
  fix the race.
- Catching and silencing errors to make a test pass.
- Adding a flag to a function to handle one caller's edge case.
  Refactor the call sites or split the function.
- Wrapping a third-party type in a local type that adds nothing.
- Introducing a new dependency to do something the stdlib already
  does well.
- Disabling a lint rule globally to fix one file.
- Committing commented-out code. Delete it; `git log` remembers.
- `// TODO: fix later` without an issue link and an owner.
- `git push --force` to a shared branch. To force-push your own
  branch, use `--force-with-lease`.

---

## 13. Commits + pull requests

- **Conventional Commits**: `feat:`, `fix:`, `refactor:`, `chore:`,
  `docs:`, `test:`, `perf:`, `build:`, `ci:`. Scope optional.
- **One concern per PR.** "Fix sync race condition and also redesign
  the empty state" is two PRs. A reviewer can land one and bounce
  the other only if they're separate.
- **PR description should answer**: what changed, **why**, how you
  verified it (which gates ran, which docs you consulted for
  non-obvious behavior), and any deliberate follow-ups you didn't
  do.
- **Never force-push a shared branch.**
- **Never amend a published commit.** Make a new one.

---

## 14. Reviewing pull requests

If you'd like to help by reviewing instead of (or in addition to)
contributing code:

- Pull the branch locally and run `make ci`. CI passing is
  necessary but not sufficient — many regressions only show up at
  runtime.
- For UI changes, test in a browser. Type checks pass on lots of
  things that look broken to a human.
- Be specific in feedback. "This could be clearer" with no
  suggestion is hard to act on; quote the line and propose the
  change.
- Distinguish blockers from preferences. Use phrases like "blocking:
  ...", "non-blocking nit: ...", "consider for a follow-up: ..."
  so the author knows what's required vs. nice-to-have.

---

## 15. Code of conduct

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Be kind. Disagreement
is fine; rudeness is not.

---

## 16. Areas where help is welcome

The [roadmap](docs/ROADMAP.md) is the easiest place to find
well-scoped work. Beyond that:

- **Accessibility audits.** The app uses semantic markup and Radix
  primitives, but it hasn't had a screen-reader pass against a real
  workflow.
- **i18n.** Everything is in English right now. The infrastructure
  to localize isn't there yet, but discussing the approach is
  welcome.
- **Push notifications on iOS.** Browser push is wired and works on
  desktop and Android out of the box. iOS Safari only delivers Web
  Push to installed PWAs, and the install prompt's iOS path is
  manual ("Share → Add to Home Screen") — a sharper install-detect
  with an onboarding hint would help adoption.
- **Better empty states.** A few corners of the UI still show "—"
  or "nothing yet" where a more useful prompt would help.
- **Performance budgets.** No per-page bundle-size budget today.
  Defining one + wiring it into CI would be valuable.
- **Stripe Tax.** Automatic VAT collection for EU customers — the
  Checkout Session is already structured to enable it.

If you're not sure whether something is worth doing, **file an
issue and ask**. A five-line conversation up front beats a
500-line wrong PR.

Thanks for being here.
