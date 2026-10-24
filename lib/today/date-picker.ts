/** The reasons `showPicker()` is specified to refuse: the input isn't
 *  mutable (InvalidStateError), the call lacks a user gesture
 *  (NotAllowedError), or it comes from a cross-origin frame (SecurityError).
 *  https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/showPicker#exceptions */
const REFUSALS = new Set([
  "InvalidStateError",
  "NotAllowedError",
  "SecurityError",
]);

/** Open a date input's platform picker from a visible trigger (call it in
 *  the trigger's click handler, which carries the user gesture). Returns
 *  "opened", or "unavailable" when this browser has no `showPicker()` (an
 *  older WebView) or refuses it for one of its documented reasons — the
 *  caller then shows the input itself. Any other error is a bug and is
 *  rethrown. */
export function openDatePicker(
  input: HTMLInputElement,
): "opened" | "unavailable" {
  // Typed as always present, but missing before Safari 16 / Firefox 101.
  const showPicker = (input as Partial<Pick<HTMLInputElement, "showPicker">>)
    .showPicker;
  if (typeof showPicker !== "function") return "unavailable";
  try {
    showPicker.call(input);
    return "opened";
  } catch (error) {
    if (error instanceof DOMException && REFUSALS.has(error.name))
      return "unavailable";
    throw error;
  }
}
