/**
 * @vitest-environment jsdom
 */
import en from "@/messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as NavModule from "./nav";

/** Settings stays easy to reach on a phone: from ANY view it is two taps
 *  away through the topbar's avatar menu — open the menu, pick Settings —
 *  whether or not the tab bar has a More tab (the Suggestions change takes
 *  More out of it; the menu must not depend on that). Signed in or not. */

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/hooks/use-user", () => ({
  useUser: () =>
    auth.signedIn
      ? {
          user: { id: "u1", email: "a@example.com" } as User,
          localUserId: "u1",
          isOfflineUnverified: false,
          isLoaded: true,
          isUnconfigured: false,
        }
      : {
          user: null,
          localUserId: null,
          isOfflineUnverified: false,
          isLoaded: true,
          isUnconfigured: false,
        },
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
vi.mock("@/lib/db", () => ({ getProfile: () => Promise.resolve(null) }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowser: () => null }));
// The topbar's other controls are beside the point here.
vi.mock("./FastingChip", () => ({ FastingChip: () => null }));
vi.mock("./NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("./SyncModeIndicator", () => ({ SyncModeIndicator: () => null }));
vi.mock("./SyncStatusPill", () => ({ SyncStatusPill: () => null }));
vi.mock("./ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("./ThemeMenuItem", () => ({ ThemeMenuItem: () => null }));
vi.mock("./TopbarSearchButton", () => ({ TopbarSearchButton: () => null }));
vi.mock("./NotificationsSheet", () => ({ NotificationsSheet: () => null }));

/** The registry as it is, and as it will be once More leaves the tab bar. */
const REGISTRIES = [
  ["with More in the tab bar", true],
  ["with MORE_IN_TAB_BAR = false", false],
] as const;

beforeEach(() => {
  vi.resetModules();
  auth.signedIn = true;
});

afterEach(() => {
  cleanup();
  vi.doUnmock("./nav");
});

async function loadTopbar(moreInTabBar: boolean) {
  vi.doMock("./nav", async (importOriginal) => {
    const nav = await importOriginal<typeof NavModule>();
    return moreInTabBar
      ? nav
      : {
          ...nav,
          TAB_BAR: nav.TAB_BAR.filter((slot) => slot !== "more"),
          MORE_IN_TAB_BAR: false,
        };
  });
  const nav = await import("./nav");
  expect(nav.MORE_IN_TAB_BAR).toBe(moreInTabBar);
  const { Topbar } = await import("./Topbar");
  return { Topbar, VIEW_KEYS: nav.VIEW_KEYS };
}

describe.each(REGISTRIES)("Settings on a phone, %s", (_, moreInTabBar) => {
  it.each([
    ["signed in", true],
    ["a guest", false],
  ])("is two taps from every view for %s", async (_who, signedIn) => {
    auth.signedIn = signedIn;
    const { Topbar, VIEW_KEYS } = await loadTopbar(moreInTabBar);
    for (const view of VIEW_KEYS) {
      const onSelectView = vi.fn();
      render(
        <NextIntlClientProvider
          locale="en"
          messages={en}
        >
          <Topbar
            current={view}
            onSelectView={onSelectView}
          />
        </NextIntlClientProvider>,
      );
      // Tap 1: the avatar (account) menu.
      const avatar = screen.getByRole("button", {
        name: signedIn ? "a@example.com" : /account menu/i,
      });
      fireEvent.keyDown(avatar, { key: "Enter" });
      // Tap 2: Settings.
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Settings" }),
      );
      expect(onSelectView).toHaveBeenCalledWith("settings");
      cleanup();
    }
  });
});
