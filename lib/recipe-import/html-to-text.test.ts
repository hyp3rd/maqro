import { describe, expect, it } from "vitest";
import { htmlToReadableText } from "./html-to-text";

describe("htmlToReadableText", () => {
  it("strips script and style blocks entirely", () => {
    const html =
      "Before<script>var x = 1; console.log('inside script');</script>After<style>.foo{color:red}</style>End";
    const out = htmlToReadableText(html);
    expect(out).not.toContain("var x");
    expect(out).not.toContain("console.log");
    expect(out).not.toContain("color:red");
    expect(out).toContain("Before");
    expect(out).toContain("After");
    expect(out).toContain("End");
  });

  it("strips HTML comments", () => {
    const out = htmlToReadableText(
      "Visible<!-- hidden tracking blob -->Also visible",
    );
    expect(out).not.toContain("hidden tracking blob");
    expect(out).toContain("Visible");
    expect(out).toContain("Also visible");
  });

  it("preserves paragraph structure across block elements", () => {
    const out = htmlToReadableText(
      "<p>First paragraph.</p><p>Second paragraph.</p>",
    );
    expect(out).toContain("First paragraph.");
    expect(out).toContain("Second paragraph.");
    // The two paragraphs land on separate lines — verify by index
    // comparison rather than a multi-line regex (the /s dotall flag
    // requires a target TS lib higher than this project's setting).
    const firstIdx = out.indexOf("First paragraph.");
    const secondIdx = out.indexOf("Second paragraph.");
    expect(out.slice(firstIdx, secondIdx)).toContain("\n");
  });

  it("renders <br> as a line break", () => {
    const out = htmlToReadableText("Line one<br>Line two<br/>Line three");
    const lines = out.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toEqual(["Line one", "Line two", "Line three"]);
  });

  it("decodes the common HTML entities a recipe page actually uses", () => {
    const out = htmlToReadableText(
      "Salt &amp; pepper&nbsp;&mdash; to taste&hellip; &quot;done&quot;",
    );
    expect(out).toContain("Salt & pepper");
    expect(out).toContain("—");
    expect(out).toContain("…");
    expect(out).toContain('"done"');
  });

  it("decodes numeric character references", () => {
    const out = htmlToReadableText("&#8211;&#x2014;&#233;");
    expect(out).toContain("–");
    expect(out).toContain("—");
    expect(out).toContain("é");
  });

  it("collapses excessive whitespace and blank lines", () => {
    const out = htmlToReadableText(
      "<p>One</p>\n\n\n\n\n<p>Two</p>     <span>Three</span>",
    );
    // No more than 2 consecutive newlines, and no run of spaces.
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).not.toMatch(/ {3,}/);
  });

  it("truncates output past the 50 KB byte cap", () => {
    const giant = "a".repeat(60_000);
    const out = htmlToReadableText(`<p>${giant}</p>`);
    expect(out.length).toBeLessThanOrEqual(50_000);
  });

  it("returns a usable string when the input has no HTML at all", () => {
    const out = htmlToReadableText("Just plain text with no tags.");
    expect(out).toBe("Just plain text with no tags.");
  });

  it("handles empty input", () => {
    expect(htmlToReadableText("")).toBe("");
  });
});
