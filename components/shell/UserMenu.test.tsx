/**
 * @vitest-environment jsdom
 */
import {
  __resetSyncStatusForTests,
  bumpPending,
  setSyncError,
  setSynced,
  setSyncing,
} from "@/lib/sync-status";
import en from "@/messages/en.json";
import type { ReactElement } from "react";
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

/** Sign-out from the in-app account menu must never silently delete local
 *  changes: in the default local-first mode edits only reach the server on
 *  Save / next load, and sign-out wipes IndexedDB. The menu syncs first and
 *  confirms before discarding anything still unsynced. */

const mockTriggerSync = vi.hoisted(() => vi.fn());
const mockSignOutAndClearLocal = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sync", () => ({ triggerSync: mockTriggerSync }));
vi.mock("@/lib/auth/sign-out", () => ({
  signOutAndClearLocal: mockSignOutAndClearLocal,
}));
vi.mock("@/lib/db", () => ({ getProfile: () => Promise.resolve(null) }));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => SUPABASE,
}));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: { id: "user-a", email: "a@example.com" } as User,
    isLoaded: true,
    isUnconfigured: false,
  }),
}));
vi.mock("@/hooks/use-notification-drawer", () => ({
  useNotificationDrawer: () => ({
    open: false,
    setOpen: () => {},
    openDrawer: () => {},
    unreadCount: 0,
    notifications: [],
    onView: () => {},
    onDismiss: () => {},
  }),
}));

const SUPABASE = vi.hoisted(() => ({
  auth: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    getUser: (...args: unknown[]) => mockGetUser(...args),
  },
}));

function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

async function clickSignOut() {
  const { UserMenu } = await import("./UserMenu");
  renderWithIntl(<UserMenu />);
  const trigger = await screen.findByRole("button", {
    name: /a@example\.com/i,
  });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /sign out/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSyncStatusForTests();
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: "user-a" } } },
    error: null,
  });
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockSignOutAndClearLocal.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("UserMenu sign-out", () => {
  it("syncs before wiping, and signs out straight away once everything landed", async () => {
    bumpPending();
    mockTriggerSync.mockImplementation(async () => {
      expect(mockSignOutAndClearLocal).not.toHaveBeenCalled();
      // The engine's status sequence: a run starts (claiming every write
      // made so far), then lands it all.
      setSyncing();
      setSynced();
      return { conflicts: [] };
    });

    await clickSignOut();

    await waitFor(() =>
      expect(mockSignOutAndClearLocal).toHaveBeenCalledTimes(1),
    );
    expect(mockTriggerSync).toHaveBeenCalledWith(SUPABASE, "user-a");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before discarding changes the sync couldn't push, and Cancel keeps the session", async () => {
    bumpPending();
    bumpPending();
    bumpPending();
    mockTriggerSync.mockImplementation(async () => {
      const err = new Error("Failed to fetch");
      setSyncError(err);
      throw err;
    });

    await clickSignOut();

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(
      /3 changes on this device haven't synced/i,
    );
    expect(mockSignOutAndClearLocal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mockSignOutAndClearLocal).not.toHaveBeenCalled();
  });

  it("signs out when the user confirms losing the unsynced changes", async () => {
    bumpPending();
    mockTriggerSync.mockImplementation(async () => {
      const err = new Error("Failed to fetch");
      setSyncError(err);
      throw err;
    });

    await clickSignOut();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /sign out anyway/i }));

    await waitFor(() =>
      expect(mockSignOutAndClearLocal).toHaveBeenCalledTimes(1),
    );
  });
});
