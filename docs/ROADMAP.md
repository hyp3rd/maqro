# Maqro roadmap — accuracy, ergonomics, breadth, depth

> Status of the product: the core (calculator, AI meal planning + deterministic
> fallback, photo/voice/barcode logging, recipes, pantry/shopping, micronutrients,
> sync modes, 3‑tier billing, passkeys/MFA, push/email) is mature and shipped.
> These four initiatives are the highest‑leverage _next_ work — they add accuracy,
> daily ergonomics, expected breadth, and goal depth without diluting the
> local‑first / privacy‑first positioning.

Sequenced by leverage:

1. **Adaptive TDEE loop** ✓ shipped
1. **Logging quick‑add** — recent foods ✓ shipped; favorites / copy‑a‑meal next
1. **Breadth** — water/hydration + meal timestamps → eating windows / fasting
1. **Goal phases** (cut → diet break → maintenance → lean bulk)

A deliberate non‑goal list lives at the bottom.

---

## 1. Adaptive TDEE loop — _shipped_

**Problem.** TDEE is currently `BMR × activityMultiplier`, where the multiplier
comes from a static dropdown ([components/macro/types.ts](../components/macro/types.ts)).
That dropdown is the single biggest source of error in any macro app. We already
_detect_ plateaus and _suggest_ a recalibration ([lib/trends.ts](../lib/trends.ts)
`recalibrateTdee`), but it's advisory‑only and requires the user to copy a number
into the Calculator's manual‑TDEE field. Two weaknesses: it's a manual loop, and
its math assumes the user ate **exactly to target**.

**Approach — the dynamic / energy‑balance method.** Infer maintenance directly
from what the user _actually logged_ vs. how their weight _actually moved_:

```text
observedTDEE ≈ mean(daily logged intake)  −  (weight‑trend slope × 7700 kcal/kg)
```

This beats `recalibrateTdee` because it reads real intake from the logs (no
"ate to target" assumption) and is self‑consistent under a _consistent_ logging
bias — if you under‑count by 10% every day, the inferred maintenance is in your
own logged units and a target set from it still produces the intended trend.
(Failure mode is _inconsistent_ logging → gated by a coverage threshold.)

**Algorithm** — `inferAdaptiveTdee()` in [lib/trends.ts](../lib/trends.ts):

- Smoothed weight series (reuse `smoothWeights`, 7‑day SMA) over a 28‑day window.
- Weight slope via least‑squares fit over the smoothed window (steadier than an
  endpoint difference).
- Mean logged intake over the **same** interval (logged days only, calories > 0).
- `observedTDEE = meanIntake − slopeKgPerDay × 7700`, rounded to 10 kcal, clamped
  to the manual‑TDEE bounds [800, 6000].
- Confidence (`none|low|medium|high`) from window span, weigh‑in count, and
  logged‑day coverage. Returns `observedTdee: null` until there's enough data
  (≥14‑day span, ≥10 logged days).

**Data model.** No migration for the MVP — computed on the fly from existing
`weightHistory` + `dailyLogs`. (A future `tdeeEstimates`/target‑history store would
power a "TDEE over time" chart and an auto‑adapt audit trail.)

**UX surfaces.**

- **Progress → Trends** ([ProgressView.tsx](../components/macro/ProgressView.tsx)
  `TrendsSection`): replace the advisory‑only card with an actionable one —
  observed maintenance + confidence + comparison to current target + **"Use this
  as my TDEE"** one‑click apply (`patchProfile("manualTdee", …)` → `computeMacros`
  re‑derives everything).
- **Calculator → manual‑TDEE field** ([PersonalInfoForm.tsx](../components/macro/PersonalInfoForm.tsx)):
  a "Suggested from your trend: X" badge + Apply.

**Pro‑gating (decided).** The estimate + one‑click apply ship **free** — it's the
core accuracy/trust story. Deferred to a **Pro phase 2**: **auto‑adapt** (hands‑off
weekly re‑estimation that nudges the target) and a **TDEE‑over‑time history chart**
— giving Pro genuine intelligence beyond "sync + micronutrients."

**Status — shipped.**

- `inferAdaptiveTdee()` + 8 unit tests in `lib/trends.ts` / `lib/trends.test.ts`;
  shared `ADAPTIVE_DELTA_THRESHOLD` + `confidenceLabel()` so every surface agrees.
- Live **Progress → Trends** card with one‑tap "Use N kcal as my TDEE"
  (`patchProfile("manualTdee", …)` → targets recompute + toast). `recalibrateTdee`
  retained as the weights‑only fallback.
- Mirrored (read‑only) into the **print report** (`app/report/page.tsx`) so the PDF
  shows the same maintenance number as the app.
- Verified live end‑to‑end (estimate, apply→toast, card clears after apply).

**Not done (Pro phase 2):** auto‑adapt, TDEE‑over‑time chart, and the optional
Calculator manual‑TDEE "suggested from your trend" badge.

---

## 2. Logging quick‑add — _shipped (recent foods)_

**Problem.** The highest‑frequency action is re‑logging the same foods. Templates
exist but are heavyweight (explicit save, separate view). No recent/frequent list,
no "copy yesterday's dinner."

**Shipped — recent-foods quick-add (free, no migration).**

- `recentLoggedFoods()` ([lib/recent-foods.ts](../lib/recent-foods.ts)) — derives
  recent foods from `dailyLogs` (deduped by name, recency-ranked, 30‑day window),
  reconstructing an addable per‑100g `Food` from each item's `originalValues`
  snapshot (or backing it out of the scaled values). 9 unit tests.
- `useRecentFoods()` hook + a **"Recent" list in the food‑search empty state**
  ([FoodSearchSheet.tsx](../components/macro/FoodSearchSheet.tsx)): one tap re‑adds a
  food at its last portion via the existing `logFoodToMeal` path (so it scales +
  draws down the pantry identically), and the sheet stays open for rapid logging.
  Search tile hint now reads "Recent + database."

**Not done (fast follow-ups).**

- **Frequent foods** (frequency-ranked view/toggle — `extractFoodPreferences`
  already exists) and **explicit favorites** (a synced `favoriteFoods` store).
- **Copy a meal**: re‑add a previous day's whole meal slot into today.

**Open questions (for the follow-ups).** Favorites = explicit star vs.
auto‑frequency? Whether to add a recency↔frequency toggle.

---

## 3. Breadth — hydration + eating windows / fasting — _planned_

**Problem.** No water tracking (universally expected), and logs are keyed by date
with meals as _slots_ — there's **no time‑of‑day** anywhere, which blocks IF /
eating‑window tracking and meal‑timing insights.

**Approach.**

- **Hydration**: a `waterIntake` store (`{date, ml}`) + a tap‑to‑add counter with a
  goal; show on Progress.
- **Meal timestamps**: add an optional `loggedAt`/`time` to logged meals (additive,
  back‑compatible). Unlocks: eating‑window length, first/last‑meal times, "% of
  calories after 8pm," and a simple fast timer.

**Data model.** New `waterIntake` store; additive optional timestamp on meal/log
records (no breaking change). Both synced.

**UX.** Water widget on Calculator/Progress; eating‑window summary + optional fast
timer; timing insights feed the existing meal‑insights engine.

**Gating.** Water free; advanced timing insights a candidate Pro hook.

**Open questions.** Where the fast timer lives; default hydration goal (formula vs.
fixed); whether timing is per‑meal or per‑food.

---

## 4. Goal phases — _planned_

**Problem.** Goals are linear (`lose|maintain|gain` + `weeklyRateKg`). Serious users
run _phases_: a cut, a diet break / refeed, maintenance, a lean bulk — with planned
transitions. The plateau/recalibration machinery is begging for this.

**Approach.** A `goalPhases` concept: an ordered list of `{type, startDate,
durationWeeks, weeklyRateKg}` that drives the active target by date, with scheduled
transitions and gentle nudges ("diet break recommended after 10 weeks of deficit").
Integrates with Adaptive TDEE (re‑estimate maintenance at each phase boundary).

**Data model.** A `goalPhases` store (or a `phases` array on the profile), synced.
Likely wants the target‑history store deferred from initiative 1.

**UX.** A phase planner in Settings/Calculator; the active phase shown on the
dashboard; phase transitions surfaced in Trends.

**Gating.** Strong **Pro** candidate (depth for the precise audience).

**Open questions.** Preset templates (e.g., "12‑wk cut → 2‑wk break") vs. fully
custom; how aggressively to auto‑advance phases.

---

## 5. Activity-based TDEE & health-platform sync — _later (needs native apps)_

**Goal.** Pull real activity (steps, active energy, workouts, sleep, scale weight)
and push nutrition back, to ground TDEE in measured expenditure instead of a static
activity dropdown.

**Hard platform constraint (verified June 2026).** maqro is a web PWA, and the two
OS health stores are **on-device, native-only** — there is no web path:

- **Apple HealthKit** has no web/backend API; data only leaves the device through a
  **native iOS app**. Even the wearable aggregators (Terra, Rook, Vital) require
  _their mobile SDK inside a native app_ to read Apple Health.
- **Google Fit's REST API is shutting down** (no new signups since May 2024, full
  shutdown end of 2026). Its successor **Health Connect is an on-device Android API**
  — also native-only.

So Apple Health / Health Connect ⇒ **shipping a native companion app** (App Store /
Play presence, native build + review + upkeep). That's a separate **native-app
track**, deliberately deferred until the web product is further along.

**Web-feasible subset (no native code).** First-party **cloud OAuth wearables** —
**Fitbit Web API** (Google's own recommended migration target), **Oura v2**,
**Withings**, **Garmin Health**, **Polar** — expose REST + webhooks the Next.js
backend can use directly. Keeps data first-party (vendor → our backend), which fits
the no-third-party-tracking positioning far better than an aggregator.

**TDEE model (platform-agnostic — the valuable part).** Do **not** wire activity in
as `TDEE = BMR + watch active-calories`: wearable active-energy runs ±20–30% off, so
that's likely _worse_ than the adaptive loop (#1), which already measures true
expenditure from `intake − weight trend` (the MacroFactor/RP approach, which
deliberately ignores watch calories). Use activity instead to:

- **bootstrap** the activity multiplier before there's enough weight/intake history;
- map **steps** (more consistent across devices than the calorie estimate) → a
  measured activity factor;
- **detect** sustained activity-load changes to nudge the adaptive estimate faster
  than the lagging weight trend;
- show activity as **context** beside weight/intake.

**Architecture.** A pluggable `ActivitySource` interface so vendors and (later)
HealthKit/Health Connect are interchangeable adapters behind one model.

**Phasing.**

- **5a — web track (optional, no native):** direct OAuth with 1–2 cloud wearables
  (Fitbit + Oura) → steps + active energy → feed the TDEE model as bootstrap +
  change-detector.
- **5b — native track (later):** wrap the existing PWA in **Capacitor** + HealthKit /
  Health Connect plugins to read on-device activity (and optionally write
  calories/macros/water back), POSTing to the backend. This is the App-Store/Play
  commitment noted above.

**Tensions.** Aggregators (Terra/Vital) add a third party in the health-data path +
per-user cost + a privacy-positioning conflict → prefer **direct vendor OAuth**.

**Sources.** [HealthKit (no web API)](https://developer.apple.com/documentation/healthkit)
· [Google Fit → Health Connect migration](https://developer.android.com/health-and-fitness/health-connect/migration/fit)
· [Fitbit Web API](https://dev.fitbit.com/build/reference/web-api/)
· [Terra: Apple Health needs the mobile SDK](https://docs.tryterra.co/health-and-fitness-api/mobile-only-sources/ios-swift)

---

## Deliberate non‑goals (for now)

- **Social / community / leaderboards** — dilutes the no‑tracking, privacy‑first
  positioning; huge surface. Skip unless it becomes the whole strategy.
- **Proprietary barcode/nutrition DB** — Open Food Facts already covers
  barcode→macros; don't try to out‑database the incumbents.
- **Freeform "AI coach" chatbot** — targeted AI (insights, planning) already exists;
  tightening the TDEE loop beats a chat surface on ROI and risk.
