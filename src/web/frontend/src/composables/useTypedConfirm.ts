import { ref } from "vue";
import { useConfirm } from "primevue/useconfirm";

/** The confirmation group TypedConfirmDialog listens on. */
export const TYPED_CONFIRM_GROUP = "typed-name";

/** What must be typed for the open dialog; shared with TypedConfirmDialog. */
export const typedExpected = ref("");
/** Bumped on every open so a reopened dialog starts empty. */
export const typedNonce = ref(0);

export interface TypedConfirmOptions {
  header: string;
  /** The consequence, in plain words. */
  message: string;
  /** The exact text the operator has to type. */
  expected: string;
  acceptLabel: string;
}

/**
 * Confirm an action that cannot be undone by typing the name of what it
 * affects. An OK button is a reflex; typing the name is the smallest thing
 * that cannot be done by accident.
 */
export function useTypedConfirm() {
  const confirm = useConfirm();

  return function confirmTyped(options: TypedConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      typedExpected.value = options.expected;
      typedNonce.value += 1;
      confirm.require({
        group: TYPED_CONFIRM_GROUP,
        header: options.header,
        message: options.message,
        icon: "pi pi-exclamation-triangle",
        acceptLabel: options.acceptLabel,
        rejectLabel: "Cancel",
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      });
    });
  };
}
