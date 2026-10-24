/**
 * @vitest-environment jsdom
 */
import { AiUsageProvider } from "@/hooks/use-ai-usage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AiUsageSection } from "./AiUsageSection";
import { GenerateRecipeDialog } from "./GenerateRecipeDialog";
import type { PersonalInfo } from "./types";

/** An AI call landing a 2xx must refresh the ONE shared usage state, so the
 *  counter (and the 80% near-cap warning) shown beside it is current — the
 *  provider no longer re-fetches per component. */

vi.mock("@/hooks/use-user", () => ({
  useUser: () => ({
    user: { id: "u1" } as User,
    isLoaded: true,
    isUnconfigured: false,
  }),
}));
vi.mock("@/lib/db", () => ({
  listCustomFoods: async () => [],
  listDailyLogs: async () => [],
  listPantryItems: async () => [],
  todayKey: () => "2026-06-10",
}));

const PROFILE = {
  dietPreference: "omnivore",
  cuisinePreferences: [],
  allergies: [],
  dislikedFoods: [],
} as unknown as PersonalInfo;

const fetchMock =
  vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Free user, 10 AI calls a month; `usedCounts` are the successive answers
 *  of /api/billing/usage. */
function routeFetch(usedCounts: number[], generateStatus: number) {
  let usageCalls = 0;
  fetchMock.mockImplementation(async (input) => {
    if (input === "/api/billing/usage") {
      const used = usedCounts[Math.min(usageCalls, usedCounts.length - 1)];
      usageCalls += 1;
      return json(200, { used, cap: 10, tier: "free", isPremium: false });
    }
    if (input === "/api/recipes/generate") {
      return generateStatus === 200
        ? json(200, {
            recipe: {
              name: "Chicken rice bowl",
              servings: 2,
              ingredients: [],
              instructions: [],
            },
          })
        : json(generateStatus, { error: "AI request failed." });
    }
    throw new Error(`unexpected fetch ${input}`);
  });
}

const usageCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/billing/usage").length;

function renderAppSlice() {
  return render(
    <AiUsageProvider>
      <AiUsageSection />
      <GenerateRecipeDialog
        open
        onOpenChange={() => {}}
        profile={PROFILE}
        onDraft={() => {}}
      />
    </AiUsageProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AI call → shared usage refresh", () => {
  it("a successful generation refreshes the counter and surfaces the near-cap warning", async () => {
    routeFetch([7, 8], 200);
    renderAppSlice();
    expect(await screen.findByText("7 / 10")).toBeTruthy();
    expect(screen.queryByText("2 left")).toBeNull();
    expect(usageCalls()).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    });

    expect(await screen.findByText("8 / 10")).toBeTruthy();
    // 8 of 10 is the 80% line: the warning the user needs before lock-out.
    expect(screen.getByText("2 left")).toBeTruthy();
    expect(usageCalls()).toBe(2);
  });

  it("a failed generation (not debited) does not re-fetch usage", async () => {
    routeFetch([7, 8], 502);
    renderAppSlice();
    expect(await screen.findByText("7 / 10")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("AI request failed."),
    );
    expect(usageCalls()).toBe(1);
    expect(screen.getByText("7 / 10")).toBeTruthy();
  });
});
