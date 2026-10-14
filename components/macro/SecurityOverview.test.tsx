/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SecurityOverview } from "./SecurityOverview";
import {
  SecurityStatusProvider,
  type SecurityStat,
  type SecurityStatusKey,
  useReportSecurityStatus,
} from "./security-status";

afterEach(cleanup);

/** A throwaway section that publishes one stat on mount, like the real
 *  Settings sections do once their data resolves. */
function Reporter({ k, stat }: { k: SecurityStatusKey; stat: SecurityStat }) {
  const report = useReportSecurityStatus();
  useEffect(() => {
    report(k, stat);
  }, [k, stat, report]);
  return null;
}

describe("SecurityOverview", () => {
  it("renders nothing until at least one section reports", () => {
    const { container } = render(
      <SecurityStatusProvider>
        <SecurityOverview />
      </SecurityStatusProvider>,
    );
    expect(container.querySelector("section")).toBeNull();
  });

  it("renders a pill for each reported stat, in fixed order", () => {
    render(
      <SecurityStatusProvider>
        <SecurityOverview />
        <Reporter
          k="passkeys"
          stat={{ value: "None", tone: "muted" }}
        />
        <Reporter
          k="twoStep"
          stat={{ value: "On", tone: "good" }}
        />
        <Reporter
          k="backupEmail"
          stat={{ value: "Set", tone: "good" }}
        />
      </SecurityStatusProvider>,
    );

    expect(screen.getByText(/your account security/i)).not.toBeNull();
    // Values render…
    expect(screen.getByText("On")).not.toBeNull();
    expect(screen.getByText("Set")).not.toBeNull();
    expect(screen.getByText("None")).not.toBeNull();

    // …and the labels follow the canonical ORDER (twoStep → passkeys →
    // backupEmail), not the order they reported in.
    const pills = Array.from(document.querySelectorAll("li")).map(
      (li) => li.textContent ?? "",
    );
    expect(pills).toHaveLength(3);
    expect(pills[0]).toContain("Two-step");
    expect(pills[0]).toContain("On");
    expect(pills[1]).toContain("Passkeys");
    expect(pills[2]).toContain("Backup email");
  });

  it("a later report for the same key replaces the earlier value", () => {
    const { rerender } = render(
      <SecurityStatusProvider>
        <SecurityOverview />
        <Reporter
          k="passkeys"
          stat={{ value: "None", tone: "muted" }}
        />
      </SecurityStatusProvider>,
    );
    expect(screen.getByText("None")).not.toBeNull();

    rerender(
      <SecurityStatusProvider>
        <SecurityOverview />
        <Reporter
          k="passkeys"
          stat={{ value: "2 added", tone: "good" }}
        />
      </SecurityStatusProvider>,
    );
    expect(screen.getByText("2 added")).not.toBeNull();
  });
});
