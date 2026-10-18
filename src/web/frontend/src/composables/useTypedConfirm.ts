import { ref } from "vue";

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

/** An image of the target next to the heading, such as a mod's icon. */
export interface ConfirmMedia {
  name: string;
  slug?: string;
  src?: string;
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
  media: ConfirmMedia | null;
  /** Replaces the level's default label above the heading. */
  levelLabel: string;
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
    media: null,
    levelLabel: "",
  };
}

/** The open dialog's extras; shared with TypedConfirmDialog like `typedExpected`. */
export const confirmExtras = ref<ConfirmExtras>(defaultExtras());
