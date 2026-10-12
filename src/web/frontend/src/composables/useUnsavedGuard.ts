/**
 * One place that knows whether any editor on the page holds unsaved work, so
 * the things that would throw it away (closing the tab, changing view or
 * server) can ask before doing it.
 *
 * The router's `beforeEach` (router.ts) and in-view switches call
 * `confirmLeave` below; `beforeunload` covers the browser itself.
 */
type DirtySource = () => boolean;

const sources = new Set<DirtySource>();
let listening = false;

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  // Legacy browsers only show the prompt when returnValue is set.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  event.returnValue = "";
}

function ensureListener(): void {
  if (listening || typeof window === "undefined") return;
  window.addEventListener("beforeunload", onBeforeUnload);
  listening = true;
}

function releaseListener(): void {
  if (!listening || sources.size > 0 || typeof window === "undefined") return;
  window.removeEventListener("beforeunload", onBeforeUnload);
  listening = false;
}

/** Register an editor's dirty state; returns the function that unregisters it. */
export function registerDirtySource(source: DirtySource): () => void {
  sources.add(source);
  ensureListener();
  return () => {
    sources.delete(source);
    releaseListener();
  };
}

export function hasUnsavedChanges(): boolean {
  for (const source of sources) if (source()) return true;
  return false;
}

/**
 * Resolve true when it is fine to leave: nothing is dirty, or the user agreed
 * to discard. `ask` renders the confirmation (PrimeVue's ConfirmDialog in the
 * app, a stub in tests).
 */
export async function confirmLeave(
  ask: () => Promise<boolean>,
): Promise<boolean> {
  if (!hasUnsavedChanges()) return true;
  return ask();
}

/** Test seam: forget every registered editor. */
export function clearDirtySources(): void {
  sources.clear();
  releaseListener();
}
