/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "./card";

afterEach(() => cleanup());

describe("Card", () => {
  it("renders a hairline panel with header and body", () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Body</CardTitle>
          <CardDescription>Used for your targets</CardDescription>
        </CardHeader>
        <CardBody>Content</CardBody>
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card.className).toContain("bg-card");
    expect(card.className).toContain("border-border/60");
    expect(
      screen.getByRole("heading", { level: 3, name: "Body" }),
    ).toBeTruthy();
    expect(screen.getByText("Used for your targets").className).toContain(
      "text-muted-foreground",
    );
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("takes the heading level from the page outline", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle as="h2">Today</CardTitle>
        </CardHeader>
      </Card>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Today" }),
    ).toBeTruthy();
  });

  it("renders as its child element (e.g. a landmark section)", () => {
    render(
      <Card asChild>
        <section aria-label="Meal timing">Rows</section>
      </Card>,
    );
    const region = screen.getByRole("region", { name: "Meal timing" });
    expect(region.tagName).toBe("SECTION");
    expect(region.className).toContain("bg-card");
  });

  it("merges a caller's classes over the defaults", () => {
    render(
      <Card
        data-testid="card"
        className="rounded-xl"
      />,
    );
    const { className } = screen.getByTestId("card");
    expect(className).toContain("rounded-xl");
    expect(className).not.toContain("rounded-lg");
  });
});
