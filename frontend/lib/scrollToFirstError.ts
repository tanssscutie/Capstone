// lib/scrollToFirstError.ts
// When a form's Continue / Submit is pressed with something invalid, bring the
// first problem into view instead of leaving the user to hunt for a red line
// somewhere above the fold.
//
// Every inline validation message spreads VALIDATION_ERROR_MARK, which
// react-native-web renders as a `data-validation-error` attribute; the first
// one in document order is the top-most error on the page. Web only, same as
// the rest of this app's form flows (see pickWebFile.ts) — a no-op elsewhere.

/** Spread onto an inline validation message: `<Text style={...} {...VALIDATION_ERROR_MARK}>`. */
export const VALIDATION_ERROR_MARK = { dataSet: { validationError: 'true' } } as {};

/** Call right after turning a form's errors on (e.g. setAttempted(true)). Waits
 *  two frames so the messages that state change reveals are in the DOM, then
 *  scrolls the first into the middle of the screen (clear of the floating
 *  header) and focuses the field it belongs to. */
export function scrollToFirstError(): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const message = document.querySelector<HTMLElement>('[data-validation-error]');
      if (!message) return;
      message.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fieldFor(message)?.focus({ preventScroll: true });
    }),
  );
}

/** The input the message sits under: the nearest one sharing its parent or
 *  grandparent. Null for errors that aren't about a typed field (a missing
 *  file, an unticked checkbox) — those just get scrolled to. */
function fieldFor(message: HTMLElement): HTMLElement | null {
  let scope: HTMLElement | null = message.parentElement;
  for (let depth = 0; scope && depth < 2; depth += 1, scope = scope.parentElement) {
    const field = scope.querySelector<HTMLElement>('input:not([type="hidden"]), textarea');
    if (field) return field;
  }
  return null;
}
