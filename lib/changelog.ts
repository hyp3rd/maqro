/** Static changelog data + helpers.
 *
 *  Entries live as a code constant rather than markdown files so the
 *  bundle stays self-contained - no extra MDX loader, no
 *  filesystem reads at request time. The list is small enough (~one
 *  entry per release) that a flat array is the right shape.
 *
 *  Each entry's `id` MUST be stable across edits: it doubles as the
 *  "last seen" key the in-app indicator writes to localStorage. If
 *  you rename an id, every existing user will see the dot reappear
 *  even though they've already read the entry. Date-prefixed slugs
 *  give natural ordering AND uniqueness; use that pattern.
 *
 *  Order in the array is newest-first. The page renders in array
 *  order, so prepend new entries at the top.
 *
 *  Tone guidance: write for users, not engineers. "Faster export
 *  for large recipe lists" beats "Refactored RecipeListExporter to
 *  use streaming serializer". When a release is mostly internal
 *  cleanup, write a short single line and skip the bullets. */

export type ChangelogEntry = {
  /** Stable identifier (date-prefixed slug). Doubles as the
   *  localStorage "seen" key. */
  id: string;
  /** ISO date (YYYY-MM-DD). Displayed; not used for sorting (array
   *  order wins). */
  date: string;
  /** Optional app version tag - surfaces in the entry header so a
   *  user comparing their installed version can match. */
  version?: string;
  title: string;
  /** Body paragraphs / bullet groups. Plain text; the renderer
   *  splits on double-newline for paragraphs and on leading "- "
   *  for bullets. Keep it simple - if we ever need rich markup,
   *  upgrade to mdx then. */
  body: string;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-06-13-faster-mobile-logging",
    date: "2026-06-13",
    version: "0.8.11",
    title: "Faster, more tactile logging on your phone",
    body: `Small touches that make logging on a phone quicker and more satisfying.

- **Add food straight from a meal.** Once a meal already has something in it, its menu (the ⋯ button) now has a quick **Add food** — drop in one more thing without stepping through the whole "Log meal" flow.
- **Logging you can feel.** Add a food and its meal card lights up and scrolls into view, with a gentle buzz so you know it landed.
- **Calories left, right on your daily card.** No more mental math — see how much you have left against today's target the moment you start logging.
- **A quiet well-done.** Reach your calorie target for the day and you'll get a small confirmation.
- **Clearer prompts at limits.** When something needs an account or Pro, you now get a proper sign-in or upgrade prompt instead of a toast that's easy to miss.`,
  },
  {
    id: "2026-06-07-meal-scheduling-and-ai-day-planner",
    date: "2026-06-07",
    version: "0.7.0",
    title: "Plan your week: recipe schedules, cards, and an AI day-planner",
    body: `A big update to how you plan meals around your recipes.

- **Schedule a recipe across days.** "Cook once, log for…" now saves a real schedule instead of writing into days you can't see. Pick a recipe, a date range, and the weekdays — it shows up in a new **Scheduled** list in Recipes (edit or cancel anytime), and on each of those days the matching meal slot offers a one-tap **"Log it."** Nothing is logged ahead of time, so your day stays honest to what you actually ate.
- **Recipe cards.** Your recipes are now a tidy card grid with a diet badge — **Vegan / Vegetarian / Omnivore**, worked out from the ingredients — and the cuisine at a glance.
- **Don't know what to eat today?** One tap asks the AI to build a breakfast / lunch / dinner day from **your own saved recipes** that lands near your remaining targets. Review it, shuffle for another, or log the whole day at once. It picks from what you've saved — it won't invent food — and counts toward your monthly AI usage.
- **Recipe → shopping list.** Open a recipe and tap to send any of its ingredients straight to your shopping list.`,
  },
  {
    id: "2026-06-05-faster-food-lookups",
    date: "2026-06-05",
    version: "0.6.6",
    title: "Faster food search and barcode scans",
    body: `Food lookups from Open Food Facts — searching for a food, and scanning a barcode — now come back faster, especially the first one after the app's been idle. It's automatic; nothing to set up.`,
  },
  {
    id: "2026-06-04-goal-phase-warning",
    date: "2026-06-04",
    version: "0.6.0",
    title: "A heads-up before a goal phase raises your target",
    body: `Goal phases (Pro) let you sequence a cut → diet break → maintenance → lean bulk, and your daily target follows whichever phase is active today.

Now, if you apply a phase or preset whose cut would actually *raise* today's calorie target — which happens when your current setting already runs a steeper deficit — a quick confirmation shows the before → after calories and why, so "start a cut" can't quietly bump your calories up without you noticing. Every other change applies straight through.`,
  },
  {
    id: "2026-06-04-intermittent-fasting",
    date: "2026-06-04",
    version: "0.5.1",
    title: "Intermittent fasting — live timer, phases, and history",
    body: `Track an eating window from start to finish.

- Start a fast from the day view and watch a live timer count toward your eating window, on a protocol you choose (16:8, 18:6, 20:4, or custom).
- The Fasting page shows where your current fast sits on an hour-by-hour phase timeline (fed → glycogen → fat-burning → ketosis → autophagy), with a plain not-medical-advice note — the timings are popular-protocol approximations, not clinical fact.
- Every fast you finish is now saved to a history with its duration, the deepest phase it reached, and a per-phase breakdown — and it syncs across your devices like the rest of your data.`,
  },
  {
    id: "2026-06-04-profile-reorg",
    date: "2026-06-04",
    version: "0.5.0",
    title: "A tidier Profile — measurements, docs, and billing together",
    body: `Your Profile is now the home for your body data and account bits.

- Your age comes from a **birthdate** you set once, so it (and your targets) stay current on their own.
- Two tiles open your health history — **My measurements** (blood pressure + body-measurement trends) and **My docs** (your saved report PDFs) — and a today weigh-in now updates your Profile weight automatically.
- **Billing & subscription** moved out of Settings to its own Profile tile, alongside your monthly AI-usage meter. Settings is regrouped into clear sections (Account, Security, App settings, Danger zone).`,
  },
  {
    id: "2026-06-04-reports-and-backups",
    date: "2026-06-04",
    version: "0.4.2",
    title: "Health-rich reports and private, encrypted backups",
    body: `Your data, in two new forms.

- The **report** now folds in blood pressure, hydration, intermittent fasting, your calorie/TDEE settings, trends, and your micronutrient breakdown — and renders as a clean, polished **PDF** you can download or **archive to your private cloud storage**.
- **Backups** are complete (every health table included) and can be **end-to-end encrypted** with a passphrase only you know — zero-knowledge, so lose the passphrase and even we can't read it. Restore from disk or cloud the same way.`,
  },
  {
    id: "2026-06-03-hydration",
    date: "2026-06-03",
    version: "0.2.10",
    title: "Track your water",
    body: `Log your daily water with a quick tap-to-add counter, against a goal scaled to your bodyweight and shown in your units (ml or fl oz). It appears on your Progress card and in your report, and syncs across devices like everything else.`,
  },
  {
    id: "2026-06-02-adaptive-tdee-quick-add",
    date: "2026-06-02",
    version: "0.2.6",
    title: "A smarter maintenance estimate, and faster logging",
    body: `Two quality-of-life wins.

- **Adaptive TDEE** — Progress infers your real maintenance calories from what you've actually logged versus how your weight moved, and nudges you to recalibrate when the two drift apart.
- **Quick-add** — a per-meal hub puts your recent foods one tap away, so logging the things you eat often no longer means searching every time.`,
  },
  {
    id: "2026-06-02-sync-modes",
    date: "2026-06-02",
    version: "0.2.1",
    title: "Choose how your data syncs",
    body: `You can now choose how this device saves your changes to your account, under Settings → Sync.

- Local-first keeps every edit on this device until you save — most private, nothing leaves until you say so. A gentle reminder appears if you've had unsaved changes for a while.
- Auto-save uploads on a timer you choose (1–30 minutes) whenever there are unsaved changes.
- Always sync uploads moments after each change, so your account and other devices stay current without you thinking about it.

The sync control in the top bar now shows a clear "Save" button when you have unsaved changes, with a small chip beside it showing which mode you're in — tap it to change.`,
  },
  {
    id: "2026-06-02-meal-detail",
    date: "2026-06-02",
    version: "0.2.0",
    title: "Dive into any meal",
    body: `Tap the Insights chip on any logged meal to open a full breakdown.

- See the macro split and sub-macros (fiber, sugars, saturated fat) at a glance, plus how the meal fits your day — its share of your calorie and protein goals.
- A balance check flags what's worth knowing: low fiber, high saturated fat, a fat-heavy split, or a great source of a vitamin. Pro adds a per-meal micronutrient read.
- Want ideas? Pro users can request tailored "next time" suggestions, with a quick heads-up that it uses one of your monthly requests.`,
  },
  {
    id: "2026-06-01-mobile-logging",
    date: "2026-06-01",
    title: "A cleaner way to log on your phone",
    body: `A round of mobile polish across the app.

- Logging a meal on a phone is now a guided flow: pick the meal, then pick how — search, a recipe or template, barcode, photo, or voice — and the right tool opens full-screen.
- The meal log, pantry, and shopping list use tap-to-open sheets instead of cramped rows of tiny icons, and removing a shopping item now offers an Undo.
- Charts open full-screen in landscape with pinch-to-zoom, so a 60-day trend is finally readable on a phone.
- Every "are you sure?" is a consistent confirmation sheet now — no more stray browser pop-ups.`,
  },
  {
    id: "2026-05-30-gestures-dri-ai-enrichment",
    date: "2026-05-30",
    version: "0.1.123",
    title: "Pull-to-refresh, smarter targets, fuller micronutrient coverage",
    body: `A batch of touch + micronutrient improvements.

- Pull down anywhere in the app to sync with your other devices — the same gesture you already expect on mobile.
- Double-tap a logged food (on touch) to duplicate it. Quick "I ate two of these" without retyping.
- Micronutrient targets are now tailored to your age and sex (NIH recommended intakes) instead of a single label value — so, for example, iron is held to the right target whether you're a man or a pre-menopausal woman. If your profile doesn't specify, it falls back to the FDA Daily Value.
- When Open Food Facts has no data for a food, we now fill the gap with an AI estimate (clearly flagged as an estimate in your report) so generic and home-cooked foods still count toward your totals.`,
  },
  {
    id: "2026-05-30-recipe-micronutrients",
    date: "2026-05-30",
    version: "0.1.122",
    title: "Recipes count toward micronutrients",
    body: `Foods you log from a recipe now contribute their vitamins and minerals, not just macros.

- When you build a recipe, each ingredient's micronutrients (from Open Food Facts) are saved alongside its macros. Applying the recipe to a meal carries them through, so a recipe-logged breakfast shows up in your Micronutrients card and report just like a directly-logged one.
- Existing recipes pick this up the next time you add or re-save an ingredient that has Open Food Facts data.`,
  },
  {
    id: "2026-05-30-micronutrient-trends",
    date: "2026-05-30",
    version: "0.1.121",
    title: "Micronutrient trends, in the app",
    body: `The Progress view's Micronutrients card now charts trends, not just averages.

- Tap any nutrient row to expand a day-by-day chart of your intake, with the FDA Daily Value drawn as a reference line. Tap again to collapse, or tap the chart to view it full-screen.
- The average-vs-DV bars stay the at-a-glance summary; the trend is there when you want to see whether your iron or vitamin D is drifting over time.`,
  },
  {
    id: "2026-05-30-micronutrients-accuracy",
    date: "2026-05-30",
    version: "0.1.119",
    title: "More accurate micronutrients",
    body: `Two improvements to how vitamins, minerals, and fiber get filled in.

- Branded and barcode-scanned foods now keep their exact micronutrient values from the moment you log them, instead of relying on an approximate lookup by name. The number you see is the product you actually ate.
- For generic foods (e.g. "chicken breast"), the background enrichment now takes the median across the top Open Food Facts matches rather than the first one it finds — so one oddly-labelled product can't skew the estimate.

Already-logged foods keep working via the name-based lookup; new logs of branded foods just get more precise.`,
  },
  {
    id: "2026-05-30-sign-in-with-apple",
    date: "2026-05-30",
    version: "0.1.118",
    title: "Sign in with Apple",
    body: `You can now sign in — or sign up — with your Apple ID.

- "Continue with Apple" joins Google, passkeys, and passwordless email on the login screen.
- Already have an account? Link Apple (or Google) from Settings → Connected accounts so any of them gets you in. Unlinking is blocked when it's your only way to sign in, so you can't lock yourself out.`,
  },
  {
    id: "2026-05-30-micronutrients",
    date: "2026-05-30",
    version: "0.1.117",
    title: "Micronutrient tracking (Pro)",
    body: `See past calories — track vitamins, minerals, and fiber too.

- A new Micronutrients card on the Progress view shows your average daily intake of fiber, sodium, potassium, calcium, iron, magnesium, zinc, and vitamins C, D & B12 — each against its FDA Daily Value.
- The data fills in quietly in the background. As you log foods, we look them up on Open Food Facts and cache what we find; branded and barcode-scanned foods have the best coverage.
- Add a Micronutrients section to your PDF report (Export → it's on by default) to hand a clinician or dietitian a printable summary of your habitual intake.

Micronutrient tracking is a Pro feature. Foods that aren't in Open Food Facts simply show "no data" — the report is honest about coverage rather than guessing.`,
  },
  {
    id: "2026-05-30-feature-explainers-and-load-more",
    date: "2026-05-30",
    version: "0.1.116",
    title: "Explainers on security, Load more on the changelog",
    body: `Polish pass focused on what things do, not just where they are.

- Settings → Passkeys, Two-factor, and Backup email each get a short, personalized intro at the top explaining what the feature actually buys you. Read it once and dismiss; it remembers per device.
- Changelog now paginates instead of stretching forever — the latest five entries render up front, with a "Show older" button revealing the rest in batches.
- /help has a new Account & security section answering the three questions we keep seeing: what's a passkey, what's two-factor, and what's the backup email for.
- README, the landing FAQ, and the privacy + terms pages now mention passkeys consistently so the docs match what's shipped.`,
  },
  {
    id: "2026-05-29-passkeys",
    date: "2026-05-29",
    version: "0.1.112",
    title: "Sign in with a passkey",
    body: `Passkeys are back, now that Supabase ships them natively.

- Sign in: a new "Sign in with a passkey" button on the login page. Tap it and your device prompts for Face ID / Touch ID / Windows Hello / your hardware key. No email, no code. The button only appears on browsers that actually support WebAuthn.
- Settings → Passkeys: add as many passkeys as you want (one per device is typical — your phone, your laptop, your YubiKey). Rename them inline so you remember which is which; remove any you no longer use.
- Adding a passkey replaces the two-factor prompt on the device that has it. The TOTP code in your authenticator app still works as a fallback if you lose your passkey, and Trusted Devices is unchanged.

Heads up: passkeys are tied to the domain that issued them — your existing passkeys for other sites are unaffected, and Maqro passkeys won't follow you to another domain.`,
  },
  {
    id: "2026-05-29-touch-gestures-pass",
    date: "2026-05-29",
    version: "0.1.111",
    title: "Touch gestures: swipe rows, swipe between days",
    body: `Mobile-first interactions, finally. All of these are touch-only — desktop keeps the explicit buttons you already know.

- Shopping list rows: swipe left to remove, swipe right to send to pantry. The reveal bars colour-code the intent so you can see which action will fire before you commit.
- Pantry rows: swipe left to delete, swipe right to send to your shopping list.
- Meal log: swipe left on the date strip to advance a day, swipe right to go back.

If you reach for the gesture and nothing happens, the row is probably in edit mode — we suppress swipe while a qty / note editor is open so an accidental drag doesn't blow away what you typed.

Coming in the next pass: pull-to-refresh and double-tap quick actions — the engine is in place, the surfaces just need the right handlers wired in.`,
  },
  {
    id: "2026-05-29-shopping-count-edit-pwa-icon",
    date: "2026-05-29",
    version: "0.1.110",
    title: "Edit the “×” count on shopping rows, and the install icon is back",
    body: `Two small fixes.

- Shopping list: the "3×" / "4×" count next to each row is now editable alongside the quantity. Tap the meta and you get two inputs — grams on the left, count on the right. Overrides only apply to rows aggregated from your meals; restock items still show a single quantity.
- PWA install: installing the app from your browser now shows the Maqro mark instead of a generic globe. The manifest was pointing at SVG-only icons, which desktop Chrome and Edge handled but iOS and older Android installers silently ignored.`,
  },
  {
    id: "2026-05-29-push-admin-mfa-paste",
    date: "2026-05-29",
    version: "0.1.109",
    title:
      "Push toggle unblocked, admin gets the MFA prompt, codes are paste-able",
    body: `Three small fixes that smooth out the second-factor flow.

- Push notifications: if you had push enabled and then turned the daily reminder off, the push toggle stayed grayed out — leaving you stuck on. The toggle now allows you to turn push off in that state; enabling it from scratch still requires the daily reminder.
- Admin actions: when a sensitive admin action asks you to re-verify your second factor, the verification prompt now appears right on the page instead of a "second factor required" banner. This fixes a bug where some admin actions weren't asking for your second factor when they should have.
- Pasting a 6-digit code into an MFA / backup-email field now works even when the code was copied with surrounding whitespace — the input was truncating valid digits before the cleanup step ran. There's also a clipboard icon on each of those inputs so you can tap to paste instead of fighting the system context menu.`,
  },
  {
    id: "2026-05-29-shopping-pantry-deep-pass",
    date: "2026-05-29",
    version: "0.1.108",
    title: "Shopping + pantry round-trip: tighter, kinder, more tested",
    body: `Quiet quality-of-life fixes from the final pre-launch sweep.

- Sample data no longer leaves your shopping-list preferences behind when you sign in for real — only the demo profile, logs and weights were being cleared.
- Deleting a row from the shopping list now actually deletes it. Previously, deleting a row that you'd also added as a "Restock" item from the pantry would let the restock copy re-appear.
- Keyboard users can now reorder shopping list items across aisles — Tab to the grip, Space to pick up, arrow keys to move, Space to drop, Esc to cancel.
- Deleting a pantry item also cleans up any shopping-list notes / aisle / restock entry attached to that item, so the list stops tracking things you no longer have.
- The shopping list PDF report now shows when the snapshot was generated and refreshes itself when you return to its tab — easier to tell whether you're looking at the latest list.`,
  },
  {
    id: "2026-05-29-shopping-list-delete-and-color",
    date: "2026-05-29",
    version: "0.1.107",
    title: "Shopping list: delete items, color the aisles, simpler row meta",
    body: `Three nudges to the shopping list flow.

- Every row now has a small × to remove the item from the list — not just dim it like the checkbox does. Removed items stay hidden across range changes; a "N hidden — show" link at the bottom of the list brings them back in one tap if you change your mind.
- Each aisle now has its own color — Produce green, Dairy amber, Meat & Seafood rose, Bakery orange, Frozen sky-blue, and so on. The same palette is shared with the Pantry view's category filter chips and per-item badges, so the same Produce green reads "Produce" everywhere you see it.
- Shopping list rows now show just quantity and how many times you logged the food, not calories — the calorie figure goes stale the moment you edit the quantity, and it wasn't useful for a shopping list anyway. Aisle headers get a bit more vertical breathing room while we're here.`,
  },
  {
    id: "2026-05-29-shopping-list-edit-qty",
    date: "2026-05-29",
    version: "0.1.106",
    title: "Shopping list: edit quantities right on the row",
    body: `Tap the "200 g · 3× · 240 kcal" line on any shopping list row to edit how much you need to buy. Enter saves, Esc cancels, and your choice carries through to the copy-as-text and the PDF export.

For computed items (from your meal logs) the original aggregate stays untouched — only the buy amount is overridden, so removing your edit reverts to the calculated total. For manual "Restock" items the qty IS the source of truth, so editing changes it directly.

The shopping list PDF report now also picks up the same restock rows and edits, instead of only showing the computed totals.`,
  },
  {
    id: "2026-05-29-pantry-shopping-roundtrip",
    date: "2026-05-29",
    version: "0.1.105",
    title: "Round-trip between pantry and shopping list",
    body: `Two new icons that close the loop between what you have on hand and what you need to buy.

- Pantry rows have a new "Send to shopping list" icon. Tapping it adds the item to your shopping list in the right aisle, with a sensible default quantity. Great for items getting low when you're still away from the meal planner.
- Shopping list rows have a "Send to pantry" icon. Tapping it tops up the matching pantry item by the quantity you bought, or creates a fresh pantry row if it isn't there yet. If a manually-added "Restock" row gets sent over, it drops off the shopping list too.
- Manually-added rows are tagged "Restock" so you can tell them apart from items the meal logs pulled in, and a small × removes them if you change your mind.`,
  },
  {
    id: "2026-05-29-shopping-list-copy-export",
    date: "2026-05-29",
    version: "0.1.104",
    title:
      "Shopping list: copy as text keeps your aisles + notes; new Export PDF",
    body: `Two upgrades to the shopping list's exports.

- "Copy as text" now groups the list by aisle (Produce, Dairy & Eggs, Meat & Seafood…) and includes any notes you've attached. Paste it into a notes app, a message thread, or wherever your shopping happens, and it reads the same as on screen.
- A new "Export PDF" button opens a print-optimised report of the same list. Aisle groupings, notes, item totals and the date range all carry over. The page hides the app chrome on print so what you preview is what you get.`,
  },
  {
    id: "2026-05-29-shopping-list-drag-notes",
    date: "2026-05-29",
    version: "0.1.103",
    title:
      "Shopping list: drag items between aisles, attach notes, more breathing room",
    body: `Three improvements to the Shopping list, all keyed to the item name so they survive range changes and refreshes.

- Drag an item by its grip into a different aisle to move it. Your choice sticks for next time and is the single source of truth — winning over the pantry's aisle and the default rule.
- Items the app placed in the wrong aisle now pick up the aisle you already chose for the same food in the pantry, without making you drag it again.
- A note icon on each row opens a small inline editor — handy for "1 kg pack", "ask staff if missing", "for tonight's roast". Saved notes show under the row in light italic; Cmd/Ctrl + Enter saves, Esc cancels.
- Each row also gets a bit more vertical breathing room — the dense layout from yesterday was too tight when notes were attached.`,
  },
  {
    id: "2026-05-29-templates-shopping-stores-polish",
    date: "2026-05-29",
    version: "0.1.102",
    title: "Templates, Shopping list and Stores near you all got a polish",
    body: `Three views with the same goal: less visual noise, more usable space.

- The Templates view now shows totals in macro color (matching My foods), and the expanded ingredient list lines its weights and calories into proper columns instead of right-anchoring each row at its own width. Calories are also tinted brighter so they catch the eye on a glance.
- The Shopping list is now grouped by aisle — Produce, Dairy & Eggs, Meat & Seafood, Bakery, Pantry, Frozen, Beverages, Household, Other — each with a small icon and a per-section item count. Item rows are tighter and the per-item meta (grams, appearances, kcal) sits on the right instead of stacked below the name.
- Stores near you opens in a wider dialog that uses the screen on desktop, and you can now pick a search radius (500 m / 1 km / 3 km / 5 km / 10 km). When more results are available, a "Load more" button reveals the next batch instead of capping at 15.`,
  },
  {
    id: "2026-05-29-ui-polish-pass",
    date: "2026-05-29",
    version: "0.1.101",
    title:
      "UI polish: bigger tap targets, mobile keyboards, clearer loading and error states, a11y",
    body: `A pre-launch UI sweep — small fixes spread across the app.

- Icon buttons across the app are now 44 px tall (was 40), the iOS accessibility baseline. Easier to tap without mis-hits on a phone.
- A skeleton outline now appears the moment you open the app, instead of a blank screen while the page hydrates.
- When the Recipes, Templates, My Foods or Pantry list fails to load, you'll see a "Couldn't load — try refreshing" message instead of a "you have none yet" empty state.
- The "remove tag" X on cuisine / allergy / disliked-food chips is now always visible, not hover-only — works on a phone where there's no hover.
- The Add Custom Food form is now a real form: pressing Enter saves it, and macro fields open the numeric keyboard on phones.
- Weight and body-measurement changes in the Weekly Recap and Body Stats sections now show ↓ or ↑ alongside the color, so the direction is clear without relying on green/amber alone.
- The notification list now shows a clear focus ring when keyboard-tabbed to a row.
- The "Saved" confirmation under body measurements is now announced by screen readers, not just shown.`,
  },
  {
    id: "2026-05-29-pre-launch-medium-pass",
    date: "2026-05-29",
    version: "0.1.100",
    title:
      "Pre-launch follow-ups: photo size cap, cleaner sign-out on expiry, abuse-path throttles",
    body: `Four smaller hardening fixes ahead of launch.

- Capture-flow photo uploads are now capped at 10 MB per file (was the Supabase default of 50 MB). Phone food photos run 2–5 MB, so this is comfortable headroom and bounds the worst case if a capture link is ever replayed.
- When a background sync fails because the session has expired (refresh token rotated, JWT expired, you were signed out from another device), the app now clears the local cache and prompts you to sign in again instead of letting your edits pile up while quietly broken.
- Account recovery now throttles per backup-email address too, not only per primary. An attacker iterating guesses can't email-bomb your backup inbox by rotating the primary.
- Each account can register up to 50 active push subscriptions. Plenty for real devices; tight enough to bound a runaway script that would otherwise grow the table without limit.`,
  },
  {
    id: "2026-05-28-auth-security-pass",
    date: "2026-05-28",
    version: "0.1.99",
    title:
      "Security update: safer sign-in redirects, stronger protection for scheduled jobs, second factor required for account changes",
    body: `A targeted security audit ahead of launch closed four issues.

- The post-login redirect now refuses to send you anywhere outside the app. A crafted magic-link with a foreign \`next=\` parameter is silently replaced with your dashboard instead of being followed.
- Account deletion, recovery-email changes, and all admin actions now always prompt for your second factor, even on a "trusted" browser. The 7-day trust grant still skips the prompt for routine actions, but irreversible changes and privileged admin operations always ask — so a temporarily-borrowed device can't be used to lock you out or escalate access.
- Our scheduled jobs now verify their authentication at a steady pace, so an attacker can't use response timing to guess the secret.
- Starting a new authenticator-app setup now sweeps away any half-finished setup left over from an abandoned attempt, so stale entries don't accumulate in your account.`,
  },
  {
    id: "2026-05-28-pre-launch-hardening-2",
    date: "2026-05-28",
    version: "0.1.98",
    title:
      "More pre-launch fixes: batch-apply pantry, wasted AI credits, duplicate welcome emails",
    body: `Three more fixes from a second audit pass before launch.

- Applying a recipe across multiple days from the Recipes view now draws and stamps the pantry the same way the day-view Apply does. Before, the recipe-view batch wrote meals into the daily logs without touching the pantry, and the foods carried no link back to the items they were drawn from — so editing or removing them later couldn't restore anything.
- Importing a recipe from a URL with "Parse with AI" on no longer burns a credit when the AI step errors and we fall back to the page's built-in recipe markup. You only pay for AI when AI actually produced the result.
- The welcome email is now rate-limited per account, so a quick succession of toggle-on requests from multiple tabs can't fire more than one welcome.`,
  },
  {
    id: "2026-05-28-pre-launch-hardening",
    date: "2026-05-28",
    version: "0.1.97",
    title:
      "Pre-launch fixes: clean sign-out, AI plans draw the pantry, fewer stale stamps",
    body: `Three correctness fixes pulled in before launch.

- Signing out now clears the on-device cache before tearing down the session, so a different account signing in on the same browser starts with empty stores instead of inheriting the previous user's pantry, recipes, logs and profile.
- Auto-fill, refinement and the per-meal regenerate now restore the pantry for the foods they replace and draw the pantry for the foods they add — the same way Apply recipe does. Before, AI-generated meals appeared in your log without touching the pantry, and removing them later couldn't restore anything.
- Editing a logged food whose original pantry item has since been deleted no longer keeps a stamp pointing at the missing item, so later edits don't silently no-op.`,
  },
  {
    id: "2026-05-28-batch-skip-pantry-fix",
    date: "2026-05-28",
    version: "0.1.96",
    title:
      "Recipe batches only draw the pantry for days that actually got the recipe",
    body: `Applying a recipe across several days only changes the pantry for the days where it actually landed. Days that get skipped (because their meal layout doesn't have a slot with the matching name) no longer count against your stock — before, a 7-day batch onto a week with only 3 matching slots would still draw 7 days' worth of ingredients.`,
  },
  {
    id: "2026-05-27-demo-isolation-fix",
    date: "2026-05-27",
    version: "0.1.95",
    title: "Stop sample data leaking into real accounts",
    body: `Two related fixes around the "Try with sample data" flow.

- Pantry, recipes, custom foods, templates and favorites you add while exploring as a guest now survive signing in — only the sample profile and logs are cleared. Before, any guest-mode work was wiped on sign-in alongside the sample data.
- The "this is sample data" marker is now stored inside your local database too, not only in browser storage. In private windows (or anywhere browser storage drops the flag), sample data could leak into your real account on sign-in; it can't anymore.`,
  },
  {
    id: "2026-05-27-low-stock-polish",
    date: "2026-05-27",
    version: "0.1.94",
    title: "Sharper low-stock signals",
    body: `Three small upgrades to how the pantry warns you about what's running out.

- Set a "Low when ≤" amount per pantry item so the warning fires at the level you care about (e.g. 200 g flour, 2 eggs). Leave it blank for the smart default.
- Each pantry row shows a "Low" badge when an item is under its threshold — you don't have to wait for the bell.
- A cart icon on each row opens "Shop for me" with that item already in the list, so restocking is one tap, even when it isn't empty yet.`,
  },
  {
    id: "2026-05-27-template-pantry-parity",
    date: "2026-05-27",
    version: "0.1.93",
    title: "Meal templates draw the pantry down too",
    body: `Applying a meal template now scales the pantry the same way Apply recipe and adding a food from the meal-planner search do — matched items drop by the real amount, and removing or editing a template-applied food gives the share back.`,
  },
  {
    id: "2026-05-27-pantry-live-refresh",
    date: "2026-05-27",
    version: "0.1.92",
    title: "Pantry changes show up everywhere instantly",
    body: `Applying a recipe (or editing a pantry item) updates the pantry view and the meal-planner "In pantry" badges the moment the change lands — no reload, no waiting for sync. The write was happening; the UI just wasn't re-reading it.`,
  },
  {
    id: "2026-05-27-volume-pantry-drawdown",
    date: "2026-05-27",
    version: "0.1.91",
    title: "Liquids draw down by the real amount",
    body: `Pantry items measured by volume now scale down accurately when you cook.

- Using 250 g of milk from a 2 L carton now leaves 1.75 L — not a whole litre gone. Volume units (ml, l, cup, tbsp…) convert a recipe's grams to the right volume, the same way weights already did.
- For thicker or lighter liquids, set a density (g/ml) on the item — e.g. 0.92 for oil — and the math follows. Leave it blank for water-like liquids; the density field only shows for volume units.`,
  },
  {
    id: "2026-05-27-favourite-stores-category-fix",
    date: "2026-05-27",
    version: "0.1.90",
    title: "Favorite stores, fixable pantry categories, more shop types",
    body: `More polish on the pantry + nearby-stores tools.

- Star a shop in the "stores near you" results to save it as a favorite — your favorites show in a panel beside the shopping list and sync across your devices.
- Got a pantry item filed under the wrong aisle (or "Other")? Pick the right category in the add/edit row; the correction sticks and syncs.
- Nearby search now finds more places — health-food shops, delis, and farm shops alongside supermarkets and grocers — and "Directions" opens a proper route on Google Maps.`,
  },
  {
    id: "2026-05-27-nearby-address-and-drawer-fix",
    date: "2026-05-27",
    version: "0.1.89",
    title: "Search stores by address + notification drawer fix",
    body: `Improvements to the recent additions:

- "Find stores near me" now works even without sharing your location: start typing an address or postcode and pick from autocomplete suggestions. Use-my-location is still one tap (and now actually prompts for permission).
- Fixed the notifications drawer on phones with a notch — its close button was sitting under the status bar and couldn't be tapped. It now clears the safe area.`,
  },
  {
    id: "2026-05-27-pantry-categories-paging",
    date: "2026-05-27",
    version: "0.1.88",
    title: "Pantry categories, filtering, and tidier long lists",
    body: `Bigger pantries and shopping lists are easier to work through now.

- Pantry items are sorted into categories (Produce, Dairy & Eggs, Meat & Seafood, and so on) — each item shows its aisle, and a row of category chips lets you filter to just what you're looking for.
- Long pantries and shopping lists are paged (20 at a time) instead of one endless scroll.
- On the Shopping List, "Find stores near me" moves up into a side panel on wider screens, so nearby shops sit right next to your list.`,
  },
  {
    id: "2026-05-27-stores-near-you",
    date: "2026-05-27",
    version: "0.1.87",
    title: "Find grocery stores near you",
    body: `Shopping in person? Both the Shopping List and the new "Shop for me" panel can now point you to real shops nearby.

- Tap "Find stores near me" — with your permission we look up supermarkets and grocers around you and list the closest ones with their distance and a one-tap link to directions.
- Powered by OpenStreetMap, so it works anywhere the map data does, with no account or extra setup. Your location is only used for the search and is never stored.`,
  },
  {
    id: "2026-05-27-shop-for-me",
    date: "2026-05-27",
    version: "0.1.86",
    title: "Shop for me — from low pantry to a ready-to-order cart",
    body: `Running low? The pantry can now turn what you're out of into a shopping list and hand it straight to a store.

- Tap "Shop for me" in the Pantry. It pre-selects the items you're low on or out of, you tick what you want (and add anything else), and it builds a clean list — deduplicated, sensible pack sizes, grouped by store aisle.
- One tap opens a pre-filled Instacart cart with the whole list (where Instacart is available); for Uber Eats, DoorDash, and Glovo, each item gets a quick search link, and the whole list copies to your clipboard.
- We never complete a purchase or store any delivery-app login — you review and check out on the store yourself.`,
  },
  {
    id: "2026-05-27-pantry-powers-planning",
    date: "2026-05-27",
    version: "0.1.83",
    title: "Your pantry now plans, scales, and warns",
    body: `The pantry stopped being a standalone list and started pulling its weight across the app.

- Auto-fill and Generate recipe now prefer what you already have. The items in your pantry go to the model as a soft nudge, so generated plans and recipes lean on ingredients on your shelf when they'd fit anyway. Allergies and diet filters still come first.
- Cooking a recipe draws it down — by the right amount. When you Apply a recipe, any ingredient that matches a pantry item is subtracted: a weight-measured item (a 1 kg bag of protein powder) goes down by the grams the recipe actually uses (40 g → 0.96 kg left), while a counted item (eggs, cans) drops by one. A meal-prep batch across N days subtracts N times as much. Generating a plan never touches the pantry.
- The meal planner search box knows your pantry too. Foods you already have on hand show an "In pantry: 0.96 kg" tag in the results. Adding one draws the pantry down by that portion's grams, editing the portion adjusts it up or down, and removing or replacing the food puts the quantity straight back — whether the food came from a recipe you applied or one you searched for. Your inventory tracks what you've actually planned to eat.
- Low-stock alerts. When using something pushes an item to its last unit, a notification lands in a new bell in the top bar — and, if you've enabled push, on your phone too. The bell's count and the alerts sync across every device you're signed in on. Re-using the same item won't pile up duplicate alerts you've already seen.
- Pantry units are now a tidy dropdown (grams, kg, ml, cans, packs, scoops…) with a Custom option for anything not listed — so weights reconcile reliably instead of getting typed three different ways.`,
  },
  {
    id: "2026-05-27-meal-prep-best-fit-trust-fix",
    date: "2026-05-27",
    version: "0.1.81",
    title:
      "Meal-prep batch mode, Best-fit recipe picker, Trust this device restored",
    body: `Cook once, log for the week. The Apply recipe dialog gained a "Days" stepper alongside the existing Servings one — pick a recipe, set the day-count, hit Apply, and the same scaled ingredients land in that meal slot on today plus the next few days (up to 7). Future days that already have a meal slot with the matching name get the recipe appended; days without a log get one created from today's layout.

- Apply recipe now ranks your recipes by macro fit to the slot. Open the dialog from any meal and the list re-orders so the recipe closest to that slot's share of the day's macros sits at the top, with a "Best fit" badge when there's competition. Each row shows per-serving kcal/P/C/F so you can see why one fits.
- "Trust this device for 7 days" works as advertised again. After the recent MFA hardening, the proxy and API gates didn't know about your trust grant — every navigation looped you back through the second-factor prompt. Now both layers consult the grant on each request and let trusted browsers through for the full 7-day window. The stored grant is the source of truth; a stolen cookie alone grants nothing.

Behind the scenes:

- When you submit a change to your account, the app now checks it consistently and returns clearer errors on bad input. No change for valid requests.
- We added an automated safeguard so a future change can't accidentally skip the second-factor check on a protected action.`,
  },
  {
    id: "2026-05-26-personalization-coherence-mfa-prompt",
    date: "2026-05-26",
    version: "0.1.75",
    title:
      "Personalized plans + recipes, per-meal coherence warnings, in-app MFA prompt",
    body: `Auto-fill and AI-generated recipes now lean on what you actually eat. We sample the top foods from your last ~30 days of logs and feed them to the model as a soft preference — generated plans and recipes pick familiar ingredients over generic stock picks when both would fit. Hard filters (allergies, diet) still apply.

- Coherence warnings now anchor to the offending meal. The amber chip sits on the meal card itself ("Lunch has no protein source — only carbs and fat") with a one-tap "Regenerate this meal" button. Day-level rules (low day protein) render as a single banner above the meals with a "Try refining" action.
- "Best fit" badge in Apply recipe. Open the dialog from any meal slot and the list re-orders by per-serving fit to that slot's macro budget — the top recipe gets a "Best fit" tag when there's actual competition. Each row shows per-serving kcal/P/C/F so you can see why one fits better.
- MFA verifies in-place instead of bouncing you to /login. If a gated action (Auto-fill, Generate recipe, Cancel subscription, …) needs MFA, a small dialog opens, you enter your code, the original action retries automatically. No more "your AI plan failed, please sign in again" loops for users with TOTP.`,
  },
  {
    id: "2026-05-26-share-camera-voice-mfa",
    date: "2026-05-26",
    version: "0.1.70",
    title:
      "Branded share cards, full-screen camera, streak milestones, voice logging (beta), MFA hardening",
    body: `Share today's plate as a branded PNG. Tap Share on Daily Totals and Maqro renders a server-side card with your kcal/P/C/F that drops straight into iMessage, WhatsApp, Instagram Stories, or any Web Share target. Recipients see a clean URL that unfurls into the same card on Twitter / Slack / LinkedIn via OG meta. The PNG is signed (opt-in HMAC) so the brand can't be spoofed by hand-crafting a URL with fake numbers.

- Camera now opens full-screen on mobile, with a barcode-cutout reticle in scan mode and an iOS-style round shutter in photo mode. Multi-frame capture samples 6 frames over 1.5s and picks the sharpest via Laplacian variance — meaningfully better AI input on shaky handheld shots.
- Photo-identified meals can be saved as a recipe directly from the review dialog, so a recurring meal stops costing one AI generation per log.
- Streak milestones (3, 7, 14, 30, 60, 100, 180, 365 days) fire a one-shot celebration when first crossed. A flame chip on Daily Totals shows your current run + a tooltip with days until the next milestone.
- Voice meal logging (beta) — tap Talk on Add Food, dictate "200 grams of chicken and a banana", the AI parses it into structured foods you review before adding. Falls back to typing where Web Speech isn't supported (Firefox, Brave with default Shields).
- Italian translation of the marketing pages with an "EN · IT" switcher in the site header. Auto-detects from your browser's Accept-Language on first visit; deliberate picks are remembered via cookie.
- Pricing comparison now splits "Camera identify" into Barcode scan (no AI usage) and Photo meal identification (counts toward your monthly cap) — the combined row was misleading.

Security hardening:

- Fixed a security gap where using the back button during two-factor sign-in could leave you partly signed in. A half-finished sign-in is now treated as signed-out everywhere — no email or account details shown — and a banner points you back to finish verifying.
- Sensitive actions — AI meal planning, deleting your account, billing, and admin tools — now always require your second factor, even if someone got hold of a partial sign-in. The app prompts you to verify when one of these needs it.

Mobile UX overhaul:

- Mobile bottom nav slims from 8 → 6 items. Settings + Templates move into the avatar dropdown (now visible to signed-out users too, so guests can still reach Settings).
- Recipes list no longer truncates names to 3 chars on phones — actions stack below the name on narrow viewports.
- Admin filter chips ("Last 7 days") stay on one line and wrap as a group instead of overflowing their rounded border.
- Inline-edit inputs stop triggering iOS auto-zoom; the meal-row edit also scrolls itself above the soft keyboard so Save/Cancel stay reachable.
- Progress charts get a tap-to-expand fullscreen modal (kinder than pinch-zoom on a tiny SVG).
- Dialogs no longer overflow their viewport on long content (Recipe edit, meal-photo review, webhooks detail panel).
- Camera sheet portals to <body> so the app's bottom nav / topbar can't clip it.`,
  },
  {
    id: "2026-05-25-units-explainers-help",
    date: "2026-05-25",
    version: "0.1.59",
    title: "Pick your units, understand the math, find help faster",
    body: `Metric or imperial — your call. Settings → Units (and a small toggle right above the weight + height fields on the Calculator tab) flips the whole app between kg / cm and lb / ft·in. Storage stays metric, so switching back and forth is a pure presentation change and never alters your saved data. On first run, the default is auto-picked from your browser locale.

- The (i) icons next to BMR, TDEE, and Target on the Calculator tab now open detailed explainers — the Mifflin-St Jeor formula, the activity multiplier table, the deficit math, and the caveats most people get wrong about each.
- The amber "Capped to safety floor" notice has its own explainer now too, including three concrete ways to bring your goal rate back in line (slower weekly rate, raise activity level, or calibrate your TDEE from real data).
- The /contact form now leads with a category picker. Bug? Feature? Billing? Account? Each routes to the right channel with a useful subject prefix, and tells you when the GitHub bug-report or feature-request template would get you a faster answer.
- New /about page collects everything in one place: version, "Check for updates" button, status, pricing, contact, GitHub issue templates, and socials.`,
  },
  {
    id: "2026-05-24-status-pricing-mobile",
    date: "2026-05-24",
    version: "0.1.53",
    title:
      "Public status page, a real pricing comparison, and big mobile polish",
    body: `New /status page shows live uptime for every service Maqro relies on, checked every 5 minutes and kept for 90 days. With little data it reads "Status unknown — collecting data" rather than raising a false alarm on the first failed check.

- New /pricing page lays out Free / Plus / Pro side-by-side with the full feature matrix and a monthly / yearly toggle (yearly saves about 20%).
- Cookie notice now appears (informational only — Maqro still has zero analytics, no tracking pixels, no third-party scripts; the notice exists so you know that, not because we set non-essential cookies).
- Big mobile UX pass: every public page (status, pricing, terms, privacy, contact, about) now respects the iPhone notch, has an always-visible "back to home" affordance, and stops awkward horizontal scrollbars from sneaking in.
- Admin nav on mobile / tablet collapses to a dropdown instead of overlapping the brand pill.`,
  },
  {
    id: "2026-05-23-trust-and-safety",
    date: "2026-05-23",
    version: "0.1.47",
    title: "Trust & safety: rate limits, transactional mail, security.txt",
    body: `Tighter throttles on the auth-adjacent surfaces (account recovery, backup-email setup + verify, support form) so abuse can't burn through your inbox or our Resend quota.

- Subscription, cancellation, and account-deletion now generate confirmation emails so you have a paper trail.
- If a card decline exhausts Stripe's retry schedule, you'll get a single dunning notice instead of multiple silent failures.
- Security researchers can find responsible-disclosure contact info at /.well-known/security.txt.
- New public contact form at /contact for questions, bug reports, and account help.`,
  },
  {
    id: "2026-05-15-admin-pass-and-trace",
    date: "2026-05-15",
    version: "0.1.46",
    title: "Admin tooling: real user tracing + audit log integration",
    body: `Admin users can now flag accounts for tracing and see every server-side call that account makes flow through a per-user event stream. The audit log surfaces Supabase auth events alongside in-app admin actions, so account-lock decisions have full context.`,
  },
  {
    id: "2026-05-08-in-app-billing",
    date: "2026-05-08",
    version: "0.1.42",
    title: "Manage your subscription from the app",
    body: `Subscription, invoices, and payment-method management now live in Settings → Subscription. No more round-trips to the Stripe portal for routine changes - cancel, resume, swap payment method, or download a past invoice without leaving Maqro.

A new "past due" banner appears at the top of the app if your most recent payment failed, with a one-click path to fix it.`,
  },
];

/** Newest-entry id. The in-app indicator compares this to the
 *  localStorage "last seen" value to decide whether to show the
 *  dot. Exported as a const (not a function) so it's tree-shaken
 *  into the client bundle without pulling the full entries array. */
export const LATEST_CHANGELOG_ID = CHANGELOG[0]?.id ?? "";

/** localStorage key for tracking which entry the user has last
 *  seen. Namespaced with `maqro:` like the rest of our client
 *  storage. */
export const CHANGELOG_SEEN_STORAGE_KEY = "maqro:changelog-seen";
