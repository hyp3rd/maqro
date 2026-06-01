/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagInput } from "./TagInput";

// RTL v16's auto-cleanup only fires when a setup file imports it via
// vitest's globals. The repo's vitest.config doesn't include a setup
// file, so call cleanup() explicitly between tests so each render
// starts in a fresh DOM.
afterEach(() => cleanup());

/** Tiny harness that lifts state up like the real callers do. Exposes
 *  the current value through a render-prop so tests can assert on it. */
function Harness({
  initial = [],
  onChangeSpy,
}: {
  initial?: string[];
  onChangeSpy?: (next: string[]) => void;
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <TagInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
      placeholder="type here"
      aria-label="tag input"
    />
  );
}

function getInput(): HTMLInputElement {
  return screen.getByRole("textbox") as HTMLInputElement;
}

describe("TagInput", () => {
  it("commits the buffer on Enter and clears the field", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "peanuts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith(["peanuts"]);
    expect(input.value).toBe("");
    expect(screen.getByText("peanuts")).toBeTruthy();
  });

  it("commits on comma without leaking the comma into the tag", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "shellfish" } });
    fireEvent.keyDown(input, { key: "," });
    expect(spy).toHaveBeenLastCalledWith(["shellfish"]);
    expect(input.value).toBe("");
  });

  it("preserves whitespace inside a multi-word tag ('peanut butter')", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "peanut butter" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith(["peanut butter"]);
  });

  it("ignores duplicate adds case-insensitively", () => {
    const spy = vi.fn();
    render(
      <Harness
        initial={["Peanuts"]}
        onChangeSpy={spy}
      />,
    );
    const input = getInput();
    fireEvent.change(input, { target: { value: "peanuts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // No new tags emitted, but the buffer should still clear.
    expect(spy).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("removes a tag when its × button is clicked", () => {
    const spy = vi.fn();
    render(
      <Harness
        initial={["peanuts", "shellfish"]}
        onChangeSpy={spy}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove peanuts"));
    expect(spy).toHaveBeenLastCalledWith(["shellfish"]);
  });

  it("Backspace on empty buffer pops the trailing tag back into the buffer", () => {
    const spy = vi.fn();
    render(
      <Harness
        initial={["peanuts", "shellfish"]}
        onChangeSpy={spy}
      />,
    );
    const input = getInput();
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Backspace" });
    // Tag removed, text restored so the user can keep editing.
    expect(spy).toHaveBeenLastCalledWith(["peanuts"]);
    expect(input.value).toBe("shellfish");
  });

  it("commits a non-empty buffer on blur (so unmatched typing isn't lost)", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "gluten" } });
    fireEvent.blur(input);
    expect(spy).toHaveBeenLastCalledWith(["gluten"]);
  });

  it("doesn't commit whitespace-only input", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
  });
});
