import type { useConfirm } from "primevue/useconfirm";
import { t } from "../i18n";

type ConfirmService = Pick<ReturnType<typeof useConfirm>, "require">;

/**
 * The "Discard unsaved changes?" question as an `ask` for `confirmLeave`.
 * Resolves false for Stay, Escape and a click outside, so only an explicit
 * "Discard and leave" lets work be thrown away.
 */
export function discardPrompt(
  confirm: ConfirmService,
  message = t("leave.message"),
): () => Promise<boolean> {
  return () =>
    new Promise<boolean>((resolve) => {
      confirm.require({
        header: t("leave.header"),
        message,
        icon: "pi pi-exclamation-triangle",
        acceptLabel: t("leave.accept"),
        rejectLabel: t("leave.reject"),
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      });
    });
}
