import { browserVisibility, type PageVisibility } from "../utils/pageVisibility";

/** Consecutive failed polls tolerated before the job is given up on. */
export const DEFAULT_POLL_RETRIES = 5;

export interface PolledJobOptions<T> {
  intervalMs: number;
  /** One read of the job's state. Captures the job id and cursor itself. */
  poll(): Promise<T>;
  /** Called with every successful poll, including the final one. */
  onUpdate?(next: T): void;
  /** True once the job has reached an end state; polling stops after `onDone`. */
  isDone(next: T): boolean;
  onDone?(next: T): void;
  /** Called once, after `retries` consecutive failures, when polling stops. */
  onError(err: unknown): void;
  retries?: number;
  visibility?: PageVisibility;
}

export interface PolledJob {
  /**
   * Begin polling, replacing any earlier run. With `immediate` the first poll
   * runs now and the returned promise settles when it has been handled;
   * otherwise it runs after one interval.
   */
  start(options?: { immediate?: boolean }): Promise<void>;
  /** Stop polling; a poll already in flight is ignored when it lands. */
  stop(): void;
  /** Stop for good and release the visibility listener. */
  dispose(): void;
}

/**
 * Follow one background job to its end.
 *
 * One policy for every poller: polls never overlap, a hidden tab pauses them
 * and a returning tab resumes them, a failed poll is retried up to `retries`
 * times in a row (the wrapper may be restarting), and after that polling stops
 * and `onError` fires once.
 */
export function usePolledJob<T>(options: PolledJobOptions<T>): PolledJob {
  const visibility = options.visibility ?? browserVisibility;
  const retries = options.retries ?? DEFAULT_POLL_RETRIES;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let active = false;
  let inFlight = false;
  let failures = 0;
  let disposed = false;

  const stopWatching = visibility.onVisible(() => {
    if (active && !inFlight && timer === undefined) schedule(generation);
  });

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(mine: number): void {
    clearTimer();
    if (disposed || visibility.isHidden()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (visibility.isHidden()) return;
      void tick(mine);
    }, options.intervalMs);
  }

  async function tick(mine: number): Promise<void> {
    if (mine !== generation || !active) return;
    inFlight = true;
    try {
      const next = await options.poll();
      if (mine !== generation) return;
      failures = 0;
      options.onUpdate?.(next);
      if (options.isDone(next)) {
        active = false;
        options.onDone?.(next);
        return;
      }
    } catch (err) {
      if (mine !== generation) return;
      failures++;
      if (failures > retries) {
        active = false;
        options.onError(err);
        return;
      }
    } finally {
      if (mine === generation) inFlight = false;
    }
    if (mine === generation && active) schedule(mine);
  }

  function start(startOptions: { immediate?: boolean } = {}): Promise<void> {
    generation++;
    clearTimer();
    inFlight = false;
    failures = 0;
    active = !disposed;
    if (!active) return Promise.resolve();
    if (startOptions.immediate) return tick(generation);
    schedule(generation);
    return Promise.resolve();
  }

  function stop(): void {
    generation++;
    clearTimer();
    inFlight = false;
    active = false;
  }

  function dispose(): void {
    disposed = true;
    stop();
    stopWatching();
  }

  return { start, stop, dispose };
}
