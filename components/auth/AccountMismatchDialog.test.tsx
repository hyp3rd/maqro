/**
 * @vitest-environment jsdom
 */
import en from "@/messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountMismatchDialog } from "./AccountMismatchDialog";

/** The wrong-account notice has exactly one outcome (continue to /login with
 *  the device already wiped), so every way of closing it must acknowledge,
 *  and never twice (each acknowledgement navigates). */

afterEach(cleanup);

function renderDialog(count: number) {
  const onAcknowledge = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
    >
      <AccountMismatchDialog
        open
        count={count}
        onAcknowledge={onAcknowledge}
      />
    </NextIntlClientProvider>,
  );
  return onAcknowledge;
}

describe("AccountMismatchDialog", () => {
  it("states how many unsynced changes were lost", () => {
    renderDialog(3);
    expect(
      screen.getByText(
        /3 changes that hadn't synced to your original account were lost/i,
      ),
    ).not.toBeNull();
  });

  it("still warns when the count is unknown", () => {
    renderDialog(0);
    expect(
      screen.getByText(/couldn't be confirmed as synced were lost/i),
    ).not.toBeNull();
  });

  it("acknowledges once from the button", () => {
    const onAcknowledge = renderDialog(1);
    fireEvent.click(
      screen.getByRole("button", { name: /continue to sign in/i }),
    );
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("treats Escape as the same acknowledgement", () => {
    const onAcknowledge = renderDialog(1);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});
