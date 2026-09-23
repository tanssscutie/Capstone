// lib/pickWebFile.ts
// Shared by every screen that needs a real Blob to upload later: Onboarding
// (DOCUMENTS step), PostRequirement (attachments), QuotationSubmission
// (attachments), AddPermit — each used to carry its own copy-pasted
// `document.createElement('input')` block. Web only: there's no native file
// picker wired up yet (see each call site's own "native fallback" comment).

/** True when a real `<input type="file">` can be created and clicked — i.e.
 *  we're actually running in a browser DOM, not a native build (which has no
 *  file picker wired up yet) or SSR. Callers check this first and fall back
 *  to placeholder metadata when it's false; pickWebFile() itself assumes DOM
 *  is available. */
export function isWebFilePickerSupported(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Opens a native file picker restricted to `accept` and resolves with the
 *  chosen File, or null if the user closed the dialog without picking one.
 *  Only call this after isWebFilePickerSupported() — it assumes DOM APIs
 *  exist. Not every browser fires `cancel` on this input yet; where it
 *  doesn't, the promise simply stays pending until a file is picked, same as
 *  the plain onchange-only version this replaced. */
export function pickWebFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
