/**
 * @vitest-environment jsdom
 */
import { addSupplement, clearAllStores } from "@/lib/db";
import { __resetSyncStatusForTests, getSyncSnapshot } from "@/lib/sync-status";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SupplementsSection } from "./SupplementsSection";

/** Supplement writes must reach the sync-pending counter like every other
 *  user-facing write: the "Save N" pill and the sign-out guard read it, and a
 *  write it can't see is wiped on sign-out without being counted. */

vi.mock("@/hooks/use-ai-usage", () => ({
  useTier: () => ({ tier: "pro", resolved: true }),
}));
vi.mock("@/hooks/use-notification-prefs", () => ({
  useNotificationPrefs: () => ({
    state: { status: "loading" },
    update: vi.fn(),
  }),
}));

beforeEach(async () => {
  await clearAllStores();
  await addSupplement({
    name: "Vitamin D3",
    doseLabel: "1 capsule",
    micros: { vitaminD: 25 },
  });
  __resetSyncStatusForTests();
});

afterEach(() => {
  cleanup();
});

describe("SupplementsSection", () => {
  it("counts a logged dose as an unsynced change", async () => {
    render(<SupplementsSection />);

    fireEvent.click(
      await screen.findByRole("button", { name: /more doses of vitamin d3/i }),
    );

    await waitFor(() => expect(getSyncSnapshot().pending).toBe(1));
  });

  it("counts removing a supplement as an unsynced change", async () => {
    render(<SupplementsSection />);

    fireEvent.click(
      await screen.findByRole("button", { name: /remove vitamin d3/i }),
    );

    // The delete plus the intake clean-up that follows it.
    await waitFor(() => expect(getSyncSnapshot().pending).toBe(2));
  });
});
