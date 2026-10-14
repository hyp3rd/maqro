/**
 * @vitest-environment jsdom
 */
import * as React from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PullToSync } from "./PullToSync";

const mocks = vi.hoisted(() => ({
  triggerSync: vi.fn(),
  reportClientError: vi.fn(),
  refresh: { current: null as null | (() => Promise<void> | void) },
}));

vi.mock("@/lib/sync", () => ({ triggerSync: mocks.triggerSync }));
vi.mock("@/lib/error-reporter", () => ({
  reportClientError: mocks.reportClientError,
}));
vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowser: () => ({}) }));
// The gesture itself is covered by PullToRefresh's own tests; capture the
// handler it would call on a completed pull.
vi.mock("@/components/gestures/PullToRefresh", () => ({
  PullToRefresh: ({
    onRefresh,
    children,
  }: {
    onRefresh: () => Promise<void> | void;
    children: ReactNode;
  }) => {
    mocks.refresh.current = onRefresh;
    return <>{children}</>;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PullToSync", () => {
  it("settles the pull and reports a failed sync instead of rejecting", async () => {
    const failure = new Error("sync failed");
    mocks.triggerSync.mockRejectedValueOnce(failure);
    render(<PullToSync>content</PullToSync>);

    await expect(mocks.refresh.current?.()).resolves.toBeUndefined();

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ route: "sync" }),
    );
  });
});
