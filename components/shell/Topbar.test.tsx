/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Topbar } from "./Topbar";
import { NAV } from "./nav";

// The bar's controls are beside the point here: only its heading is.
vi.mock("./FastingChip", () => ({ FastingChip: () => null }));
vi.mock("./NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("./SyncModeIndicator", () => ({ SyncModeIndicator: () => null }));
vi.mock("./SyncStatusPill", () => ({ SyncStatusPill: () => null }));
vi.mock("./ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("./TopbarSearchButton", () => ({ TopbarSearchButton: () => null }));
vi.mock("./UserMenu", () => ({ UserMenu: () => null }));

afterEach(() => cleanup());

describe("Topbar heading", () => {
  it("carries the view's registry title as the page's h1 by default", () => {
    render(<Topbar current="progress" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      NAV.progress.title,
    );
  });

  it("takes an overriding title", () => {
    render(
      <Topbar
        current="progress"
        title="Body"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Body");
  });

  it("renders no heading at all for a view whose own header has the h1", () => {
    // The day view: its header names the day it shows.
    render(
      <Topbar
        current="plan"
        title={null}
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText(NAV.plan.title)).toBeNull();
    // The rest of the bar is still there.
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Maqro - visit homepage" }),
    ).toBeTruthy();
  });
});
