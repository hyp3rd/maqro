/**
 * @vitest-environment jsdom
 */
import {
  readLastKnownUserId,
  writeLastKnownUserId,
} from "@/lib/auth/last-known-user";
import { readCachedTier, writeCachedTier } from "@/lib/billing/tier-cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ResetDeviceSection } from "./SettingsView";

/** Resetting a device hands it over: the per-account records kept outside
 *  IndexedDB (last-known tier and user) must go too — also when there is no
 *  session to sign out, as after an expired session was opened offline. */

const mocks = vi.hoisted(() => ({
  clearAllStores: vi.fn(async () => {}),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  clearAllStores: mocks.clearAllStores,
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({ auth: { signOut: mocks.signOut } }),
}));

const assign = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("location", { ...window.location, assign });
  writeCachedTier("u1", "pro");
  writeLastKnownUserId("u1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function resetDevice(signedIn: boolean) {
  render(<ResetDeviceSection signedIn={signedIn} />);
  fireEvent.click(screen.getByRole("button", { name: /reset device/i }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(
    Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Reset device",
    ) as HTMLButtonElement,
  );
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
}

describe("ResetDeviceSection", () => {
  it("without a session (offline-unverified) still forgets the account records", async () => {
    await resetDevice(false);
    expect(mocks.clearAllStores).toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(readLastKnownUserId()).toBeNull();
    expect(readCachedTier("u1")).toBeNull();
  });

  it("signed in: forgets them and signs out", async () => {
    await resetDevice(true);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(readLastKnownUserId()).toBeNull();
    expect(readCachedTier("u1")).toBeNull();
  });
});
