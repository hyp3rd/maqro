/** Read a byte stream into a UTF-8 string, abandoning it as soon as the
 *  running total exceeds `capBytes`. The stream is cancelled at that point,
 *  so an oversized body is never buffered past the cap.
 *
 *  A `null` body (no payload) reads as the empty string. Callers word their
 *  own error for `ok: false`: the cap means different things to an inbound
 *  request and an outbound fetch. */
export async function readWithCap(
  body: ReadableStream<Uint8Array> | null,
  capBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > capBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8").decode(merged) };
}
