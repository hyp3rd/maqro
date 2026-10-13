import { describe, expect, it } from "vitest";
import { readWithCap } from "./read-with-cap";

function streamOf(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  wasCancelled: () => boolean;
} {
  let cancelled = false;
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[i++];
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, wasCancelled: () => cancelled };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("readWithCap", () => {
  it("reads a body at or under the cap", async () => {
    const { stream } = streamOf([bytes("hello "), bytes("world")]);
    await expect(readWithCap(stream, 11)).resolves.toEqual({
      ok: true,
      text: "hello world",
    });
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const euro = bytes("€"); // 3 bytes
    const { stream } = streamOf([euro.slice(0, 1), euro.slice(1)]);
    await expect(readWithCap(stream, 3)).resolves.toEqual({
      ok: true,
      text: "€",
    });
  });

  it("stops and cancels the stream once the cap is exceeded", async () => {
    const { stream, wasCancelled } = streamOf([
      bytes("12345"),
      bytes("6"),
      bytes("never read"),
    ]);
    await expect(readWithCap(stream, 5)).resolves.toEqual({ ok: false });
    expect(wasCancelled()).toBe(true);
  });

  it("treats a missing body as empty", async () => {
    await expect(readWithCap(null, 0)).resolves.toEqual({ ok: true, text: "" });
  });
});
