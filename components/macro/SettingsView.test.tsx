/**
 * @vitest-environment jsdom
 */
import {
  __resetSyncStatusForTests,
  setSynced,
  setSyncing,
} from "@/lib/sync-status";
import en from "@/messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SettingsView } from "./SettingsView";

/** Signing out from Settings names the signed-in account to
 *  `signOutAndClearLocal`, so the records forgotten are that account's — not
 *  whichever account a possibly stale last-known record names. */

const mocks = vi.hoisted(() => ({
  signOutAndClearLocal: vi.fn(async () => {}),
  unregisterCurrentDevice: vi.fn(async () => {}),
  // Every local change lands, so sign-out proceeds without asking.
  triggerSync: vi.fn(async () => {
    setSyncing();
    setSynced();
    return { conflicts: [] };
  }),
  getSession: vi.fn(async () => ({
    data: { session: { user: { id: "user-a" } } },
    error: null,
  })),
}));
const SUPABASE = vi.hoisted(() => ({
  auth: { getSession: () => mocks.getSession() },
}));

vi.mock("@/lib/auth/sign-out", () => ({
  signOutAndClearLocal: mocks.signOutAndClearLocal,
  clearAllAccountRecords: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => SUPABASE,
}));
vi.mock("@/lib/sync", () => ({ triggerSync: mocks.triggerSync }));
vi.mock("@/lib/devices/registry", () => ({
  unregisterCurrentDevice: mocks.unregisterCurrentDevice,
}));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: {
      id: "user-a",
      email: "a@example.com",
      created_at: "2026-01-01T00:00:00Z",
    } as User,
    localUserId: "user-a",
    isOfflineUnverified: false,
    isLoaded: true,
    isUnconfigured: false,
  }),
}));
vi.mock("@/hooks/use-notification-prefs", () => ({
  useNotificationPrefs: () => ({
    state: { status: "unconfigured" },
    update: vi.fn(),
  }),
}));
// Account sections that talk to Supabase on mount; sign-out doesn't
// involve them.
vi.mock("./BackupEmailSection", () => ({ BackupEmailSection: () => null }));
vi.mock("./CloudExportsList", () => ({ CloudExportsList: () => null }));
vi.mock("./ConnectedAccountsSection", () => ({
  ConnectedAccountsSection: () => null,
}));
vi.mock("./MfaSection", () => ({ MfaSection: () => null }));
vi.mock("./PasskeysSection", () => ({ PasskeysSection: () => null }));
vi.mock("./SecurityIntro", () => ({ SecurityIntro: () => null }));
vi.mock("./SecurityOverview", () => ({ SecurityOverview: () => null }));
vi.mock("./SignedInDevicesSection", () => ({
  SignedInDevicesSection: () => null,
}));

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  __resetSyncStatusForTests();
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SettingsView sign-out", () => {
  it("forgets the signed-in account's records", async () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={en}
      >
        <SettingsView
          units="metric"
          onUnitsChange={() => {}}
          homeMarket={undefined}
          onHomeMarketChange={() => {}}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^sign out$/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(mocks.signOutAndClearLocal).toHaveBeenCalledTimes(1);
    expect(mocks.signOutAndClearLocal).toHaveBeenCalledWith(SUPABASE, "user-a");
  });
});
