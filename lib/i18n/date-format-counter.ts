import { vi } from "vitest";

/** Test helper: how many `Intl.DateTimeFormat`s `run` builds. Formatters
 *  are costly to construct, so a component builds them once per locale;
 *  pair a first render and a re-render to prove a re-render builds none.
 *  Each formatter still formats (the real constructor runs underneath). */
export function countDateFormats(run: () => void): number {
  const Original = Intl.DateTimeFormat;
  let built = 0;
  const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
  ) {
    built += 1;
    return new Original(...args);
  } as unknown as typeof Intl.DateTimeFormat);
  try {
    run();
    return built;
  } finally {
    spy.mockRestore();
  }
}
