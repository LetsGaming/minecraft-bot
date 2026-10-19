import { useToast } from "primevue/usetoast";
import { errorMessage } from "../utils/errorMessage";

type Severity = "success" | "info" | "warn" | "error";

/** How long each kind of toast stays, in milliseconds. Failures stay longest. */
export const TOAST_LIFE_MS: Record<Severity, number> = {
  success: 4000,
  info: 6000,
  warn: 7000,
  error: 8000,
};

/** Toasts with one lifetime table, so a call site says what happened and not how long to show it. */
export function useNotify() {
  const toast = useToast();

  function show(severity: Severity, summary: string, detail?: string): void {
    toast.add({ severity, summary, ...(detail ? { detail } : {}), life: TOAST_LIFE_MS[severity] });
  }

  return {
    ok: (summary: string, detail?: string) => show("success", summary, detail),
    info: (summary: string, detail?: string) => show("info", summary, detail),
    warn: (summary: string, detail?: string) => show("warn", summary, detail),
    /** `cause` may be the caught value or a ready message; either way its text becomes the detail. */
    fail: (summary: string, cause?: unknown) =>
      show("error", summary, cause === undefined ? undefined : errorMessage(cause)),
  };
}
