/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// next/script does real DOM/network work to fetch the Cloudflare bundle, which
// we don't want (and can't load) in jsdom. A no-op keeps the tree pure — the
// submit-gating we assert here is driven by the hook's token state, not by the
// script actually arriving.
vi.mock("next/script", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  vi.resetModules();
});

// SITE_KEY is read once at module load, so each branch needs a fresh import
// AFTER the env is set/cleared.
async function load() {
  vi.resetModules();
  return await import("./TurnstileWidget");
}

/** Surfaces the hook's `ready` flag and gives the test buttons to drive the
 *  token in (a solve) and back out (a reset / expiry) — exactly what the widget
 *  callbacks do at runtime. */
function makeHarness(mod: Awaited<ReturnType<typeof load>>) {
  const { useTurnstile, TurnstileWidget } = mod;
  return function Harness() {
    const t = useTurnstile();
    return (
      <div>
        <span data-testid="ready">{String(t.ready)}</span>
        <button
          type="button"
          onClick={() => t.widgetProps.onToken("tok")}
        >
          solve
        </button>
        <button
          type="button"
          onClick={t.reset}
        >
          reset
        </button>
        <TurnstileWidget {...t.widgetProps} />
      </div>
    );
  };
}

describe("useTurnstile / TurnstileWidget — unconfigured", () => {
  it("is ready immediately and renders no challenge when no site key is set", async () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const mod = await load();
    const Harness = makeHarness(mod);
    const { container } = render(<Harness />);

    // No site key → submit is never gated on a token…
    expect(screen.getByTestId("ready").textContent).toBe("true");
    // …and the widget mounts nothing (no challenge container).
    expect(container.querySelector(".min-h-\\[65px\\]")).toBeNull();
  });
});

describe("useTurnstile / TurnstileWidget — configured", () => {
  it("gates until a token arrives, then re-gates after a reset/expiry", async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
    const mod = await load();
    const Harness = makeHarness(mod);
    const { container } = render(<Harness />);

    // Configured but unsolved → not ready (the parent disables submit).
    expect(screen.getByTestId("ready").textContent).toBe("false");
    // The challenge container is mounted.
    expect(container.querySelector(".min-h-\\[65px\\]")).not.toBeNull();

    // A solved challenge hands back a token → ready.
    fireEvent.click(screen.getByText("solve"));
    expect(screen.getByTestId("ready").textContent).toBe("true");

    // A reset (failed submit) or expiry clears it → gated again, forcing a
    // fresh single-use token before the next attempt.
    fireEvent.click(screen.getByText("reset"));
    expect(screen.getByTestId("ready").textContent).toBe("false");
  });
});
