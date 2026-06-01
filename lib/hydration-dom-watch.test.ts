import { describe, expect, it } from "vitest";
import {
  type HydrationMutation,
  rankHydrationMutations,
} from "./hydration-dom-watch";

const text = (
  path: string,
  server: string,
  client: string,
): HydrationMutation => ({ kind: "text", path, server, client });

describe("rankHydrationMutations", () => {
  it("keeps a genuine server→client text divergence", () => {
    const out = rankHydrationMutations([
      text("main > dd", "Jun 1, 2026", "May 31, 2026"),
    ]);
    expect(out).toEqual([
      {
        kind: "text",
        path: "main > dd",
        server: "Jun 1, 2026",
        client: "May 31, 2026",
      },
    ]);
  });

  it("drops no-op records where server equals client", () => {
    expect(
      rankHydrationMutations([text("main > p", "Welcome", "Welcome")]),
    ).toEqual([]);
  });

  it("treats whitespace-only differences as no-ops (collapsed)", () => {
    expect(
      rankHydrationMutations([
        text("main > p", "Hello  world", "Hello world "),
      ]),
    ).toEqual([]);
  });

  it("drops records where both sides are empty", () => {
    expect(rankHydrationMutations([text("main", "", "")])).toEqual([]);
  });

  it("dedupes identical divergences", () => {
    const out = rankHydrationMutations([
      text("main > dd", "A", "B"),
      text("main > dd", "A", "B"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("ranks text before attr before node, then larger diffs first", () => {
    const out = rankHydrationMutations([
      { kind: "node", path: "n", server: "xxxxxxxx", client: "y" },
      { kind: "attr", path: "a@class", server: "dark", client: "light" },
      text("t1", "short", "x"),
      text("t2", "a much longer server string", "y"),
    ]);
    expect(out.map((m) => m.kind)).toEqual(["text", "text", "attr", "node"]);
    // Within the text group, the larger diff sorts first.
    expect(out[0]?.path).toBe("t2");
  });

  it("clips over-long values and marks them with an ellipsis", () => {
    const big = "x".repeat(500);
    const [out] = rankHydrationMutations([text("main", big, "y")]);
    expect(out?.server.endsWith("…")).toBe(true);
    expect(out?.server.length).toBeLessThanOrEqual(201);
  });

  it("caps the number of reported divergences", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      text(`p${i}`, `server-${i}`, `client-${i}`),
    );
    expect(rankHydrationMutations(many)).toHaveLength(5);
  });
});
