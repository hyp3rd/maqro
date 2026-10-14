/**
 * @vitest-environment jsdom
 */
import {
  __resetSyncStatusForTests,
  bumpPending,
  setSyncConflict,
} from "@/lib/sync-status";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SyncStatusPill } from "./SyncStatusPill";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({
  triggerSync: vi.fn().mockResolvedValue(null),
  resolveConflictsKeepingLocal: vi.fn().mockResolvedValue(null),
  discardPendingChanges: vi.fn().mockResolvedValue(null),
}));
const reportClientError = vi.hoisted(() => vi.fn());
const supabase = {};

vi.mock("@/lib/sync", () => mocks);
vi.mock("@/lib/error-reporter", () => ({ reportClientError }));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: USER_ID } }),
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => supabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetSyncStatusForTests();
});

afterEach(() => {
  cleanup();
  __resetSyncStatusForTests();
});

function renderConflict(count: number) {
  bumpPending();
  setSyncConflict(
    Array.from({ length: count }, (_, i) => ({
      table: "daily_logs",
      key: `2026-05-1${i}`,
    })),
  );
  render(<SyncStatusPill />);
}

describe("SyncStatusPill — conflict state", () => {
  it("tapping 'Needs review' only opens the choice — nothing is overwritten yet", () => {
    renderConflict(2);

    fireEvent.click(screen.getByRole("button", { name: /needs review/i }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toMatch(/can't be undone/i);
    expect(dialog.textContent).toMatch(
      /replaces the other device's for these 2 items/i,
    );
    expect(mocks.resolveConflictsKeepingLocal).not.toHaveBeenCalled();
    expect(mocks.discardPendingChanges).not.toHaveBeenCalled();
    expect(mocks.triggerSync).not.toHaveBeenCalled();
  });

  it("keeps this device's version only after the user confirms it", () => {
    renderConflict(1);
    fireEvent.click(screen.getByRole("button", { name: /needs review/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /keep this device's/i }),
    );

    expect(mocks.resolveConflictsKeepingLocal).toHaveBeenCalledWith(
      supabase,
      USER_ID,
    );
    expect(mocks.discardPendingChanges).not.toHaveBeenCalled();
  });

  it("keeps the other device's version through the discard path", () => {
    renderConflict(1);
    fireEvent.click(screen.getByRole("button", { name: /needs review/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /keep the other device's/i }),
    );

    expect(mocks.discardPendingChanges).toHaveBeenCalledWith(supabase, USER_ID);
    expect(mocks.resolveConflictsKeepingLocal).not.toHaveBeenCalled();
  });

  it("reports a failed 'keep this device's' instead of swallowing it", async () => {
    const failure = new Error("sync failed");
    mocks.resolveConflictsKeepingLocal.mockRejectedValueOnce(failure);
    renderConflict(1);
    fireEvent.click(screen.getByRole("button", { name: /needs review/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /keep this device's/i }),
    );

    await vi.waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ route: "sync" }),
      ),
    );
  });

  it("reports a failed 'keep the other device's' instead of leaving it unhandled", async () => {
    const failure = new Error("sync failed");
    mocks.discardPendingChanges.mockRejectedValueOnce(failure);
    renderConflict(1);
    fireEvent.click(screen.getByRole("button", { name: /needs review/i }));

    fireEvent.click(
      screen.getByRole("button", { name: /keep the other device's/i }),
    );

    await vi.waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ route: "sync" }),
      ),
    );
  });

  it("cancel resolves nothing", () => {
    renderConflict(1);
    fireEvent.click(screen.getByRole("button", { name: /needs review/i }));

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.resolveConflictsKeepingLocal).not.toHaveBeenCalled();
    expect(mocks.discardPendingChanges).not.toHaveBeenCalled();
  });
});

describe("SyncStatusPill — manual sync", () => {
  it("reports a failed sync started from the pill instead of leaving it unhandled", async () => {
    const failure = new Error("sync failed");
    mocks.triggerSync.mockRejectedValueOnce(failure);
    render(<SyncStatusPill />);

    fireEvent.click(screen.getByRole("button", { name: /up to date/i }));

    await vi.waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ route: "sync" }),
      ),
    );
  });
});
