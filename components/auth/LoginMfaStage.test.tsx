/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LoginMfaStage } from "./LoginMfaStage";

// useTotpChallenge calls getSupabaseBrowser; the passkey path under test doesn't
// touch it, so a bare stub is enough.
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    auth: { mfa: { challengeAndVerify: vi.fn() } },
  }),
}));

afterEach(cleanup);

const noop = () => {};

describe("LoginMfaStage — passkey escape", () => {
  it("offers the passkey button only when passkeys are supported", () => {
    const { rerender } = render(
      <LoginMfaStage
        factorId="f1"
        onVerified={noop}
        onUseDifferentEmail={noop}
        passkeySupported={false}
        onUsePasskey={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /passkey/i })).toBeNull();

    rerender(
      <LoginMfaStage
        factorId="f1"
        onVerified={noop}
        onUseDifferentEmail={noop}
        passkeySupported={true}
        onUsePasskey={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /use a passkey instead/i }),
    ).not.toBeNull();
  });

  it("runs the passkey flow and surfaces a returned error", async () => {
    const onUsePasskey = vi.fn(async () => "That passkey didn't work.");
    render(
      <LoginMfaStage
        factorId="f1"
        onVerified={noop}
        onUseDifferentEmail={noop}
        passkeySupported={true}
        onUsePasskey={onUsePasskey}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /use a passkey instead/i }),
    );
    expect(onUsePasskey).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /that passkey didn't work/i,
      );
    });
  });

  it("disables the TOTP controls while the passkey ceremony is in flight", async () => {
    let resolvePasskey: (v: string | null) => void = () => {};
    const onUsePasskey = vi.fn(
      () =>
        new Promise<string | null>((r) => {
          resolvePasskey = r;
        }),
    );
    render(
      <LoginMfaStage
        factorId="f1"
        onVerified={noop}
        onUseDifferentEmail={noop}
        passkeySupported={true}
        onUsePasskey={onUsePasskey}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /use a passkey instead/i }),
    );
    // Mid-flight: the code field + "Sign in" + "Use a different email" are all
    // gated by anyBusy, so the user can't double-submit.
    expect(
      (screen.getByPlaceholderText("123456") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /^sign in$/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    resolvePasskey(null); // settle the promise (success path navigates IRL)
    await waitFor(() => expect(onUsePasskey).toHaveBeenCalledTimes(1));
  });

  it("clears a stale passkey error when the user starts typing a code", async () => {
    const onUsePasskey = vi.fn(async () => "That passkey didn't work.");
    render(
      <LoginMfaStage
        factorId="f1"
        onVerified={noop}
        onUseDifferentEmail={noop}
        passkeySupported={true}
        onUsePasskey={onUsePasskey}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /use a passkey instead/i }),
    );
    await waitFor(() =>
      expect(screen.queryByText(/that passkey didn't work/i)).not.toBeNull(),
    );
    // Falling back to the code clears the stale passkey error — never two alerts.
    fireEvent.change(screen.getByPlaceholderText("123456"), {
      target: { value: "1" },
    });
    expect(screen.queryByText(/that passkey didn't work/i)).toBeNull();
  });

  it("always offers the lost-authenticator recovery link", () => {
    render(
      <LoginMfaStage
        factorId="f1"
        onVerified={noop}
        onUseDifferentEmail={noop}
      />,
    );
    const link = screen.getByRole("link", { name: /lost your authenticator/i });
    expect(link.getAttribute("href")).toBe("/login/recovery");
  });
});
