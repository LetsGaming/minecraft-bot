import { getCurrentScope, onScopeDispose } from "vue";

export interface Polling {
  /** Run `fn` now unless a run is already in flight. */
  tick(): Promise<void>;
  stop(): void;
}

/**
 * Run `fn` every `ms` until the owning component (or effect scope) is gone.
 *
 * The timer starts synchronously, before any await, so a route change during
 * the first load cannot leave an interval behind. A tick is skipped while the
 * previous one is still running, and nothing fires after `stop()` or unmount.
 * `immediate` runs the first tick right away.
 */
export function usePolling(
  fn: () => Promise<unknown> | unknown,
  ms: number,
  options: { immediate?: boolean } = {},
): Polling {
  let stopped = false;
  let running = false;

  async function tick(): Promise<void> {
    if (stopped || running) return;
    running = true;
    try {
      await fn();
    } catch {
      // A failed poll is the callee's to report; the next tick retries.
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), ms);

  function stop(): void {
    stopped = true;
    clearInterval(timer);
  }

  if (getCurrentScope()) onScopeDispose(stop);
  if (options.immediate) void tick();

  return { tick, stop };
}
