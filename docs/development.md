# Development

Requirements, local setup, the Make/npm scripts, and the test suites.

## Requirements

- Node.js ≥ 24 (the repo's `.nvmrc` pins 25)
- npm

## Setup

```bash
nvm use            # picks up Node 25 from .nvmrc
npm install
cp .env.local.example .env.local   # optional - only needed for auth/sync
npm run dev        # http://localhost:3000
```

Without `.env.local` the app runs in **guest mode**: everything is
stored in IndexedDB on this device and there's no sign-in. To enable
sync, follow the Supabase setup in [Configuration](./configuration.md).

## Scripts

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Dev server with Turbopack               |
| `npm run build`      | Production build                        |
| `npm run start`      | Serve the production build              |
| `npm run lint`       | ESLint                                  |
| `npm run typecheck`  | `tsc --noEmit`                          |
| `npm test`           | Vitest run-once                         |
| `npm run test:watch` | Vitest watch mode                       |
| `npm run e2e`        | Playwright (auto-starts the dev server) |
| `npm run format`     | Prettier write                          |
| `npm run db:push`    | Apply pending Supabase migrations       |
| `npm run db:status`  | Show which migrations are applied       |

A `Makefile` wraps these for CI: `make ci` runs `pre-commit fmt-check
lint typecheck test sec build` and is what must pass before any
merge. `make help` prints the full list.

## Tests

1,500+ unit + component tests across 140+ files (Vitest), plus
Playwright smoke tests and a gated auth-sync E2E spec. Highlights:

- **Macros / planner** - `lib/macros.test.ts`, `lib/meal-planner.test.ts`
- **Trends** - `lib/trends.test.ts` (smoothing, plateau detection,
  TDEE recalibration math)
- **Streaks + weekly recap** - `lib/streaks.test.ts`,
  `lib/weekly-recap.test.ts`
- **Shopping list** - `lib/shopping-list.test.ts`
- **Meal insights** - `lib/meal-insights.test.ts` (deterministic
  balance + goal-fit flags)
- **Micronutrients** - `lib/micronutrients/aggregate.test.ts`
  (per-portion scaling + partial-coverage contracts)
- **Diet classifier** - `lib/diet.test.ts`
- **IndexedDB layer** - `lib/db.test.ts`
- **Sync mappers** - `lib/sync/mappers.test.ts`
- **AI plan / recipe converters** - `lib/ai/plan.test.ts`,
  `lib/ai/recipe.test.ts`, `lib/ai/plan-coherence.test.ts`,
  `lib/ai/off-search.test.ts`
- **Agent-loop routes** -
  `app/api/meal-plan/route.test.ts`,
  `app/api/recipes/generate/route.test.ts`
- **Billing tiers** - `lib/billing/usage.test.ts`,
  `lib/billing/tiers.test.ts`
- **RBAC** - `lib/rbac.test.ts`
- **Error reporter** - `lib/error-reporter.test.ts`
- **PWA / version checker** - `hooks/use-version-check.test.ts`
- **Hooks** - `hooks/use-today.test.ts`, `hooks/use-daily-log.test.ts`
- **Imports + storage status** - `lib/import.test.ts`,
  `lib/storage-status.test.ts`
- **Smoke + auth-sync** - `tests/e2e/`

---

[← Documentation index](./README.md) · [Project README](../README.md)
