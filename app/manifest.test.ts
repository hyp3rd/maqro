import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  it("names the app after the product, not one of its screens", () => {
    // The installed app opens on Today; "Calculator" was the old home tab.
    const { name, short_name } = manifest();
    expect(name).toBe("Maqro");
    expect(short_name).toBe("Maqro");
  });
});
