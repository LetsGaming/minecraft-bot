import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { MS } from "@mcbot/schema";

export interface Poller {
  stop(): void;
}

export interface PollerOptions {
  /** Do not keep the process alive for this poller. */
  unref?: boolean;
  /** Delay before the first tick; defaults to the interval. */
  initialDelayMs?: number;
}

/** Interval used when a dynamic interval has never resolved successfully. */
const FALLBACK_INTERVAL_MS = MS.minute;

/**
 * Run `fn` repeatedly. The next tick is armed only after the previous one has
 * settled, so ticks never overlap, and a thrown or rejected tick is logged
 * under `name` instead of stopping the loop. `ms` may be a function to pick
 * the interval fresh before every tick (live config); if it throws, the last
 * good value is kept.
 */
export function startPoller(
  name: string,
  fn: () => Promise<void> | void,
  ms: number | (() => number),
  { unref = false, initialDelayMs }: PollerOptions = {},
): Poller {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInterval = typeof ms === "number" ? ms : FALLBACK_INTERVAL_MS;

  const intervalMs = (): number => {
    if (typeof ms === "number") return ms;
    try {
      lastInterval = ms();
    } catch (err) {
      log.warn(name, `Could not read the poll interval: ${errMsg(err)}`);
    }
    return lastInterval;
  };

  const arm = (delay: number): void => {
    timer = setTimeout(() => {
      timer = null;
      let run: Promise<void>;
      try {
        run = Promise.resolve(fn());
      } catch (err) {
        run = Promise.reject(err);
      }
      run
        .catch((err: unknown) => {
          log.error(name, `Poll failed: ${errMsg(err)}`);
        })
        .finally(() => {
          if (!stopped) arm(intervalMs());
        });
    }, delay);
    if (unref) timer.unref();
  };

  arm(initialDelayMs ?? intervalMs());

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
