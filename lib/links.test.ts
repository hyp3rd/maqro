import { describe, expect, it } from "vitest";
import { buildIssueUrl, GITHUB_REPO_URL } from "./links";

describe("buildIssueUrl", () => {
  it("returns a GitHub /issues/new URL on the canonical repo", () => {
    const url = buildIssueUrl({ title: "x", body: "y" });
    expect(url.startsWith(`${GITHUB_REPO_URL}/issues/new?`)).toBe(true);
  });

  it("URL-encodes title and body via URLSearchParams (handles &, =, spaces)", () => {
    const url = buildIssueUrl({
      title: "fail: a=b & c",
      body: "line 1\nline 2",
    });
    const params = new URL(url).searchParams;
    // Round-tripping through URLSearchParams decodes the canonical form,
    // so we assert on the decoded values rather than the raw string.
    expect(params.get("title")).toBe("fail: a=b & c");
    expect(params.get("body")).toBe("line 1\nline 2");
  });

  it("joins labels with comma so GitHub treats them as a list", () => {
    const url = buildIssueUrl({
      title: "x",
      body: "y",
      labels: ["bug", "needs-triage"],
    });
    expect(new URL(url).searchParams.get("labels")).toBe("bug,needs-triage");
  });

  it("omits the labels param when none are supplied", () => {
    const url = buildIssueUrl({ title: "x", body: "y" });
    expect(new URL(url).searchParams.has("labels")).toBe(false);
  });

  it("caps title at 200 chars and body at 7000 chars (browser query-string limits)", () => {
    const url = buildIssueUrl({
      title: "T".repeat(500),
      body: "B".repeat(20_000),
    });
    const params = new URL(url).searchParams;
    expect(params.get("title")?.length).toBe(200);
    expect(params.get("body")?.length).toBe(7_000);
  });
});
