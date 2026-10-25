/**
 * @vitest-environment jsdom
 */
import { intlWrapper } from "@/lib/i18n/intl-test-wrapper";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NumberTicker } from "./NumberTicker";

afterEach(cleanup);

describe("NumberTicker", () => {
  it("groups and marks decimals like every other readout (the app locale)", () => {
    const { container, unmount } = render(<NumberTicker value={1950} />, {
      wrapper: intlWrapper("en"),
    });
    expect(container.textContent).toBe("1,950");
    unmount();

    const it_ = render(
      <NumberTicker
        value={82.4}
        decimals={1}
        suffix=" kg"
      />,
      { wrapper: intlWrapper("it") },
    );
    expect(it_.container.textContent).toBe("82,4 kg");
    it_.unmount();

    const grouped = render(
      <NumberTicker
        value={-12500}
        suffix=" kcal"
      />,
      { wrapper: intlWrapper("it") },
    );
    expect(grouped.container.textContent).toBe("-12.500 kcal");
  });
});
