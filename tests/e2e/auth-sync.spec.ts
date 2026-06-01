import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** Auth + sync end-to-end coverage.
 *
 *  Approach (per the roadmap): use SUPABASE_SECRET_KEY to mint a magic-link
 *  via `admin.generateLink`, then have Playwright follow it - the
 *  `/auth/callback` route exchanges the code for a session cookie. Once
 *  signed in we assert the sync pill cycles to "Synced" and that sign-out
 *  returns the user to guest mode.
 *
 *  Skips unconditionally if any of the required env vars are absent:
 *  - SUPABASE_SECRET_KEY (server-only - never reaches the browser)
 *  - NEXT_PUBLIC_SUPABASE_URL
 *  - E2E_TEST_USER_EMAIL (a real address in the project; the user gets
 *    `email_confirm: true` so we don't need to receive a real email)
 *
 *  In CI, set these as repo/org secrets; locally, drop them in `.env.local`
 *  or export them before `npm run e2e`. */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const TEST_EMAIL = process.env.E2E_TEST_USER_EMAIL;

const SKIP_REASON =
  "E2E auth requires SUPABASE_SECRET_KEY + NEXT_PUBLIC_SUPABASE_URL + E2E_TEST_USER_EMAIL.";

test.describe("auth + sync", () => {
  test.skip(!SUPABASE_URL || !SECRET_KEY || !TEST_EMAIL, SKIP_REASON);

  test.beforeAll(async () => {
    if (!SUPABASE_URL || !SECRET_KEY || !TEST_EMAIL) return;
    // Idempotent provisioning: create the test user if missing, accept
    // the 422 / "User already registered" path otherwise. `email_confirm`
    // makes the account usable without needing to click an email link.
    const admin = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      email_confirm: true,
    });
    if (error && !/already (registered|been registered)/i.test(error.message)) {
      throw new Error(`E2E test user provisioning failed: ${error.message}`);
    }
  });

  test("signs in via magic link, sync settles, signs out", async ({ page }) => {
    if (!SUPABASE_URL || !SECRET_KEY || !TEST_EMAIL) {
      test.skip(true, SKIP_REASON);
      return;
    }

    // Generate a one-shot magic-link redirected at our own callback. The
    // base URL comes from the Playwright config so this works in CI and
    // locally without hard-coding hostnames.
    const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
    const admin = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: TEST_EMAIL,
      options: { redirectTo: `${baseURL}/auth/callback` },
    });
    if (error) throw new Error(`generateLink failed: ${error.message}`);
    const actionLink = data.properties?.action_link;
    expect(actionLink, "generateLink returned no action_link").toBeTruthy();

    // Follow the magic link in the browser. The Supabase verify endpoint
    // redirects to /auth/callback?code=..., which exchanges for a session
    // cookie and finally lands us on /.
    await page.goto(actionLink as string);
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
      timeout: 15_000,
    });

    // The sidebar's UserMenu now shows the test email - guest mode is gone.
    await expect(page.getByText(TEST_EMAIL).first()).toBeVisible({
      timeout: 10_000,
    });

    // Sync pill cycles "Syncing…" → "Synced". Give it a generous timeout
    // because runInitialSync hits the network for six tables.
    await expect(page.getByText(/Synced|Sync error/).first()).toBeVisible({
      timeout: 30_000,
    });
    // Prefer the happy path; if it timed out on a real network blip the
    // assertion above would still pass on "Sync error" - fail explicitly
    // if that's what we see.
    await expect(page.getByText("Sync error")).toHaveCount(0);

    // Sign out via the user menu. The button is on the sidebar footer.
    const userMenu = page.getByRole("button", {
      name: new RegExp(TEST_EMAIL!.split("@")[0], "i"),
    });
    await userMenu.first().click();
    await page.getByRole("menuitem", { name: /Sign out/i }).click();

    // After sign-out we should be back to guest mode - UserMenu shows
    // "Sign in" (or "Guest"), and the sync pill is no longer rendered.
    await expect(page.getByRole("link", { name: /Sign in/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
