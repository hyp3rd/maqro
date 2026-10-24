/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Callout } from "./callout";

afterEach(() => cleanup());

const TONES = ["neutral", "info", "success", "warning", "destructive"] as const;

describe("Callout", () => {
  it("defaults to the neutral tone", () => {
    render(<Callout data-testid="c">Synced a minute ago.</Callout>);
    const { className } = screen.getByTestId("c");
    expect(className).toContain("bg-muted");
    expect(screen.getByText("Synced a minute ago.")).toBeTruthy();
  });

  it.each(TONES.filter((t) => t !== "neutral"))(
    "%s tints its chrome and colours only the icon",
    (tone) => {
      render(
        <Callout
          tone={tone}
          data-testid="c"
        >
          Body
        </Callout>,
      );
      const callout = screen.getByTestId("c");
      expect(callout.className).toContain(`border-${tone}/30`);
      expect(callout.className).toContain(`bg-${tone}/5`);
      // Copy stays in the foreground colour (tone text on its own tint
      // misses 4.5:1 in light mode).
      expect(callout.className).toContain("text-foreground");
      const icon = callout.querySelector("svg");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.getAttribute("class")).toContain(`text-${tone}`);
    },
  );

  it("renders an optional title above the body", () => {
    render(
      <Callout
        tone="info"
        title="Estimated values"
      >
        Some foods were estimated from the photo.
      </Callout>,
    );
    const title = screen.getByText("Estimated values");
    expect(title.className).toContain("font-medium");
  });

  it("passes live-region semantics through for dynamic messages", () => {
    render(
      <Callout
        tone="destructive"
        role="alert"
      >
        Couldn&apos;t save. Your changes are kept on this device.
      </Callout>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Couldn");
  });

  it("can drop the icon", () => {
    render(
      <Callout
        tone="warning"
        icon={null}
        data-testid="c"
      >
        Body
      </Callout>,
    );
    expect(screen.getByTestId("c").querySelector("svg")).toBeNull();
  });
});
