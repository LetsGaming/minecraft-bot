import type { useConfirm } from "primevue/useconfirm";

type ConfirmService = ReturnType<typeof useConfirm>;

/**
 * The "Discard unsaved changes?" question as an `ask` for `confirmLeave`.
 * Resolves false for Stay, Escape and a click outside, so only an explicit
 * "Discard and leave" lets work be thrown away.
 */
export function discardPrompt(
  confirm: ConfirmService,
  message = "This tab has changes that are not saved. Leaving it discards them.",
): () => Promise<boolean> {
  return () =>
    new Promise<boolean>((resolve) => {
      confirm.require({
        header: "Discard unsaved changes?",
        message,
        icon: "pi pi-exclamation-triangle",
        acceptLabel: "Discard and leave",
        rejectLabel: "Stay",
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      });
    });
}
