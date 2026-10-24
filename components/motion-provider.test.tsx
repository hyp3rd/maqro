// @vitest-environment jsdom
import { useContext } from "react";
import { MotionConfigContext } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);

function ReducedMotionProbe() {
  const { reducedMotion } = useContext(MotionConfigContext);
  return <span data-testid="probe">{reducedMotion}</span>;
}

describe("MotionProvider", () => {
  it("makes every motion descendant honour the OS reduce-motion setting", () => {
    render(
      <MotionProvider>
        <ReducedMotionProbe />
      </MotionProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("user");
  });

  it("is needed: Motion's own default ignores the setting", () => {
    render(<ReducedMotionProbe />);
    expect(screen.getByTestId("probe").textContent).toBe("never");
  });
});
