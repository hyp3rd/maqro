import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./client";

describe("urlBase64ToUint8Array", () => {
  it("decodes a standard base64url VAPID key", () => {
    // Known fixture: base64url of bytes 0x00..0x07.
    const out = urlBase64ToUint8Array("AAECAwQFBgc");
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("handles base64url-only characters", () => {
    // "-_" are the url-safe substitutes for "+/" in standard base64.
    // Standard base64 "+/4=" → 0xfe 0xff
    const out = urlBase64ToUint8Array("-_4");
    expect(Array.from(out)).toEqual([0xfb, 0xfe]);
  });

  it("pads missing characters", () => {
    // Two padding chars required: "AA" → one byte (0x00)
    const out = urlBase64ToUint8Array("AA");
    expect(Array.from(out)).toEqual([0]);
  });
});
