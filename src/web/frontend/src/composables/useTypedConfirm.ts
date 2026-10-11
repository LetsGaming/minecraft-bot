import { ref } from "vue";
import { useConfirm } from "primevue/useconfirm";

/** The confirmation group TypedConfirmDialog listens on. */
export const TYPED_CONFIRM_GROUP = "typed-name";

/** What must be typed for the open dialog; shared with TypedConfirmDialog. */
export const typedExpected = ref("");
/** Bumped on every open so a reopened dialog starts empty. */
export const typedNonce = ref(0);

export type ConfirmLevel = "inform" | "disruptive" | "irreversible";
export type ConfirmTone = "primary" | "warn" | "danger";

export interface ConfirmFact {
  term: string;
  detail: string;
  mono?: boolean;
}

/** Everything the dialog shows beyond PrimeVue's header, message and labels. */
export interface ConfirmExtras {
  level: ConfirmLevel;
  tone: ConfirmTone;
  facts: ConfirmFact[];
  /** Label above the typed input; defaults to "Type <expected> to confirm". */
  typedLabel: string;
  /** When set, the action stays off and this says why. */
  blockedReason: string;
  /** One way out offered instead of the blocked action. */
  alternateLabel: string;
  onAlternate: (() => void) | null;
}

export function defaultExtras(): ConfirmExtras {
  return {
    level: "irreversible",
    tone: "danger",
    facts: [],
    typedLabel: "",
    blockedReason: "",
    alternateLabel: "",
    onAlternate: null,
  };
}

/** The open dialog's extras; shared with TypedConfirmDialog like `typedExpected`. */
export const confirmExtras = ref<ConfirmExtras>(defaultExtras());

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
      confirmExtras.value = defaultExtras();
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
