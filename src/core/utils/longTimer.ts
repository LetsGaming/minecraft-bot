/**
 * Timers that outlive setTimeout's range.
 *
 * setTimeout stores its delay in a signed 32-bit int, so anything past
 * ~24.8 days overflows and fires *immediately* — the worst possible
 * failure for a scheduler, because it looks like the deadline arrived.
 *
 * Two schedulers had grown their own `2 ** 31 - 1` constant and handled
 * the overflow differently: one clamped (correct only while its
 * durations stayed short), one re-armed in chunks. Chunking is the
 * behaviour that stays correct as ranges grow, so it lives here once and
 * both use it.
 */

/** setTimeout's maximum delay; beyond this it overflows and fires at once. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface LongTimer {
  /** Stop the timer. Safe to call more than once. */
  cancel(): void;
}

/**
 * Run `onDue` at `dueAt` (epoch ms), however far away that is. Waits
 * longer than the setTimeout ceiling are served by re-arming in chunks.
 * A `dueAt` already in the past fires on the next tick.
 */
export function scheduleAt(dueAt: number, onDue: () => void): LongTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const arm = (): void => {
    if (cancelled) return;
    const remaining = Math.max(0, dueAt - Date.now());
    timer = setTimeout(
      () => {
        if (cancelled) return;
        // Only a chunk of the wait elapsed — go around again.
        if (Date.now() < dueAt) {
          arm();
          return;
        }
        onDue();
      },
      Math.min(remaining, MAX_TIMEOUT_MS),
    );
  };

  arm();

  return {
    cancel(): void {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
