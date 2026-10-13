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
const supabase = {};

vi.mock("@/lib/sync", () => mocks);
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

describe("SyncStatusPill — conflict state", () => {
  it("tapping 'Needs review' keeps this device's version instead of re-running a plain sync", () => {
    bumpPending();
    setSyncConflict(1);
    render(<SyncStatusPill />);

    fireEvent.click(screen.getByRole("button", { name: /needs review/i }));

    expect(mocks.resolveConflictsKeepingLocal).toHaveBeenCalledWith(
      supabase,
      USER_ID,
    );
    expect(mocks.triggerSync).not.toHaveBeenCalled();
  });
});
