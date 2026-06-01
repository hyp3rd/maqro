// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CookieNotice } from "./CookieNotice";

/** Per-device informational banner (no analytics consent involved
 *  because the app has no analytics). These tests pin the dismissal
 *  contract and the SSR-vs-client hydration behaviour. */

const STORAGE_KEY = "maqro:cookie-notice-ack-v1";

/** Node 25's runtime ships a partially-implemented `localStorage`
 *  that's exposed on the global but missing `.getItem` / `.setItem`
 *  / `.clear` unless `--localstorage-file=…` is supplied. jsdom
 *  doesn't paper over this, so we get an object that fails the
 *  duck-typed checks below. Replace it with a deterministic in-
 *  memory shim — unconditionally, so a future Node bump that
 *  changes which methods exist doesn't silently re-break the
 *  tests. */
beforeAll(() => {
  if (typeof window === "undefined") return;
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("CookieNotice", () => {
  it("renders the banner when localStorage has no ack", () => {
    render(<CookieNotice />);
    expect(screen.getByRole("region", { name: /cookie notice/i })).toBeTruthy();
    expect(screen.getByText(/essential cookies only/i)).toBeTruthy();
  });

  it("hides the banner when a prior ack exists in localStorage", () => {
    window.localStorage.setItem(STORAGE_KEY, "2026-05-24T00:00:00.000Z");
    render(<CookieNotice />);
    expect(screen.queryByRole("region", { name: /cookie notice/i })).toBeNull();
  });

  it('dismisses on "Got it" + persists to localStorage', () => {
    render(<CookieNotice />);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByRole("region", { name: /cookie notice/i })).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("links to the privacy policy in the body copy", () => {
    render(<CookieNotice />);
    const link = screen.getByRole("link", { name: /privacy policy/i });
    expect(link.getAttribute("href")).toBe("/privacy");
  });

  it("does NOT offer accept/reject toggles (informational, not consent)", () => {
    // The app has no non-essential cookies — adding accept/reject
    // UI here would be dark-pattern theater that implies tracking
    // we don't actually do. Pin this so a future contributor
    // doesn't add it without reading the privacy-posture context.
    render(<CookieNotice />);
    expect(screen.queryByRole("button", { name: /^accept/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reject/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /manage cookies/i }),
    ).toBeNull();
  });
});
