/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PageTopBar } from "./PageTopBar";

/** Pins the landmark contract: the bar must expose a `banner`
 *  landmark containing the back link, so axe's `region` rule stays
 *  green on every page that mounts it beside `<main>` (/terms,
 *  /privacy, /contact, /about, /status, /pricing, /t/import). */

afterEach(() => {
  cleanup();
});

describe("PageTopBar", () => {
  it("renders the back link inside a banner landmark beside <main>", () => {
    render(
      <>
        <PageTopBar
          href="/"
          label="Back to home"
        />
        <main>content</main>
      </>,
    );

    const banner = screen.getByRole("banner");
    const link = within(banner).getByRole("link", { name: "Back to home" });
    expect(link.getAttribute("href")).toBe("/");
    expect(within(banner).queryByRole("main")).toBeNull();
  });

  it("defaults to the back-to-app link", () => {
    render(<PageTopBar />);

    const banner = screen.getByRole("banner");
    const link = within(banner).getByRole("link", { name: "Back to app" });
    expect(link.getAttribute("href")).toBe("/app");
  });
});
