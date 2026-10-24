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
};

describe("DayTypeChip", () => {
  it("is hidden while training is off (no training on the day's targets)", () => {
    const { container } = render(<DayTypeChip training={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("names the selected day's session, read-only by default", () => {
    render(<DayTypeChip training={LOWER} />);
    expect(screen.getByText("Lower · heavy day")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen
        .getByText("Lower · heavy day")
        .closest("[title]")
        ?.getAttribute("title"),
    ).toBe("Lower, heavy day, 18:00, 75 min");
  });

  it("says 'Rest day' on a rest day", () => {
    render(
      <DayTypeChip training={{ day: { type: "rest" }, dayClass: "rest" }} />,
    );
    expect(screen.getByText("Rest day")).toBeTruthy();
  });

  it("becomes an edit button when given onEdit", () => {
    const onEdit = vi.fn();
    render(
      <DayTypeChip
        training={LOWER}
        onEdit={onEdit}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Lower, heavy day, 18:00, 75 min. Change this day's training",
    });
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
