import { useConfirm } from "primevue/useconfirm";
import {
  TYPED_CONFIRM_GROUP,
  confirmExtras,
  typedExpected,
  typedNonce,
  type ConfirmFact,
  type ConfirmMedia,
  type ConfirmLevel,
  type ConfirmTone,
} from "./useTypedConfirm";

export type ConfirmResult = "confirm" | "cancel" | "alternate";

export interface ConfirmActionOptions {
  /**
   * inform: one button, nothing to decide.
   * disruptive: Cancel plus the action; Cancel has focus.
   * irreversible: the action unlocks only once `expected` is typed; the input has focus.
   */
  level: ConfirmLevel;
  /** Names the target: "Delete smp-daily-2026-10-09_03-00?". */
  header: string;
  /** The consequence in plain words. */
  message: string;
  acceptLabel: string;
  /** Required for `irreversible`. */
  expected?: string;
  typedLabel?: string;
  /** What, when, and how to recover; shown as a definition list. */
  facts?: ConfirmFact[];
  tone?: ConfirmTone;
  /** The action cannot run now; this says why and the action button stays off. */
  blockedReason?: string;
  /** A way out offered next to Cancel, typically while blocked. */
  alternateLabel?: string;
  cancelLabel?: string;
  /** Shown beside the heading so the target is recognisable at a glance. */
  media?: ConfirmMedia;
  /** Overrides the level's label when its default would claim too much. */
  levelLabel?: string;
}

const DEFAULT_TONE: Record<ConfirmLevel, ConfirmTone> = {
  inform: "primary",
  disruptive: "warn",
  irreversible: "danger",
};

/**
 * One confirm for every level, drawn by the shared TypedConfirmDialog host.
 * Each dialog states target, consequence and recovery; the typed level is the
 * one `useTypedConfirm` has always offered.
 */
export function useConfirmAction() {
  const confirm = useConfirm();

  return function confirmAction(options: ConfirmActionOptions): Promise<ConfirmResult> {
    if (options.level === "irreversible" && !options.expected && !options.blockedReason) {
      throw new Error("An irreversible confirm needs the text to type.");
    }
    return new Promise<ConfirmResult>((resolve) => {
      let settled = false;
      const settle = (result: ConfirmResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      typedExpected.value = options.level === "irreversible" ? (options.expected ?? "") : "";
      confirmExtras.value = {
        level: options.level,
        tone: options.tone ?? DEFAULT_TONE[options.level],
        facts: options.facts ?? [],
        typedLabel: options.typedLabel ?? "",
        blockedReason: options.blockedReason ?? "",
        alternateLabel: options.alternateLabel ?? "",
        onAlternate: options.alternateLabel ? () => settle("alternate") : null,
        media: options.media ?? null,
        levelLabel: options.levelLabel ?? "",
      };
      typedNonce.value += 1;
      confirm.require({
        group: TYPED_CONFIRM_GROUP,
        header: options.header,
        message: options.message,
        acceptLabel: options.acceptLabel,
        rejectLabel: options.cancelLabel ?? "Cancel",
        accept: () => settle("confirm"),
        reject: () => settle("cancel"),
        onHide: () => settle("cancel"),
      });
    });
  };
}
