/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "./badge";

afterEach(() => cleanup());

const TONES = ["success", "warning", "info", "brand"] as const;

describe("Badge tone variants", () => {
  it.each(TONES)("%s draws a soft tint of its tone", (tone) => {
    render(<Badge variant={tone}>Label</Badge>);
    const { className } = screen.getByText("Label");
    expect(className).toContain(`bg-${tone}/10`);
    expect(className).toContain(`border-${tone}/40`);
  });

  // Tone-coloured text on its own 10% tint drops below 4.5:1 in light mode
  // (success 4.49:1 on a card, 4.32:1 on muted), so the label stays in the
  // foreground colour and the tone is carried by the tint and border.
  it.each(TONES)("%s keeps its label in the foreground colour", (tone) => {
    render(<Badge variant={tone}>Label</Badge>);
    expect(screen.getByText("Label").className).toContain("text-foreground");
  });
});
