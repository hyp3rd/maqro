/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SecurityIntro } from "./SecurityIntro";

vi.mock("@/hooks/use-display-name", () => ({ useDisplayName: () => "" }));

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has localStorage; the guard mirrors FeatureIntro.
  }
});
afterEach(cleanup);

describe("SecurityIntro", () => {
  it("renders ONE consolidated intro covering all three protections", () => {
    render(<SecurityIntro />);
    // A single blurb names two-step verification, passkeys, and backup email —
    // replacing the three separate per-section intros.
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/two-step verification/i);
    expect(text).toMatch(/passkeys/i);
    expect(text).toMatch(/backup email/i);
    // Exactly one dismiss affordance ⇒ one intro, not three.
    expect(screen.getAllByRole("button", { name: /dismiss/i })).toHaveLength(1);
  });

  it("exposes a single dismiss affordance (one intro, not three)", () => {
    render(<SecurityIntro />);
    // The live dismissal is FeatureIntro's per-device localStorage reactivity,
    // exercised in a real browser; here we just confirm the consolidated intro
    // offers exactly one dismiss control where three used to stack.
    expect(screen.getByRole("button", { name: /dismiss/i })).not.toBeNull();
  });
});
