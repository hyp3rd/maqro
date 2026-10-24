/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DayTypeChip } from "./DayTypeChip";

afterEach(() => cleanup());

const LOWER = {
  day: {
    type: "lower" as const,
    intensity: "hard" as const,
    time: "18:00",
    durationMin: 75,
  },
  dayClass: "heavy" as const,
  overridden: false,
};
const REST_OVERRIDE = {
  day: { type: "rest" as const },
  dayClass: "rest" as const,
  overridden: true,
};

describe("DayTypeChip", () => {
  it("is hidden while training is off (no training on the day's targets)", () => {
    const { container } = render(<DayTypeChip training={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("names the selected day's session and its start, read-only by default", () => {
    render(<DayTypeChip training={LOWER} />);
    expect(screen.getByText("Lower · heavy day")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("· changed")).toBeNull();
    expect(
      screen
        .getByText("Lower · heavy day")
        .closest("[title]")
        ?.getAttribute("title"),
    ).toBe("Lower, heavy day, 18:00, 75\u00a0min");
  });

  it("leaves the time off a session without a start time", () => {
    render(
      <DayTypeChip
        training={{
          day: { type: "fullBody", intensity: "moderate" },
          dayClass: "training",
          overridden: false,
        }}
      />,
    );
    expect(screen.getByText("Full body · training day")).toBeTruthy();
  });

  it("puts the changed marker after the time", () => {
    render(<DayTypeChip training={{ ...LOWER, overridden: true }} />);
    expect(screen.getByText("· changed").parentElement?.textContent).toBe(
      "Lower · heavy day · 18:00 · changed",
    );
  });

  it("says 'Rest day' on a rest day", () => {
    render(
      <DayTypeChip
        training={{
          day: { type: "rest" },
          dayClass: "rest",
          overridden: false,
        }}
      />,
    );
    expect(screen.getByText("Rest day")).toBeTruthy();
  });

  it("marks a day whose session was changed from the plan", () => {
    render(<DayTypeChip training={REST_OVERRIDE} />);
    expect(screen.getByText("Rest day")).toBeTruthy();
    expect(screen.getByText("· changed")).toBeTruthy();
    expect(
      screen.getByText("Rest day").closest("[title]")?.getAttribute("title"),
    ).toBe("Rest day, changed from the plan");
  });

  it("becomes the edit button, named by its action, when given onEdit", () => {
    const onEdit = vi.fn();
    render(
      <DayTypeChip
        training={LOWER}
        onEdit={onEdit}
        editLabel="Change Wednesday’s session"
      />,
    );
    const button = screen.getByRole("button", {
      name: "Lower, heavy day, 18:00, 75\u00a0min. Change Wednesday’s session",
    });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("says a changed day is changed in the button's name too", () => {
    render(
      <DayTypeChip
        training={REST_OVERRIDE}
        onEdit={vi.fn()}
        editLabel="Change today’s session"
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Rest day, changed from the plan. Change today’s session",
      }),
    ).toBeTruthy();
  });
});
