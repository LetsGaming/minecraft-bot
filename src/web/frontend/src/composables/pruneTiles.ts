/**
 * The terrain tiles the prune map draws under its classes: which regions are being fetched, which
 * have arrived, and which turned out to have none. Fetching is limited to a few at a time and goes
 * nearest the middle of the view first, so a zoom or a drag fills the picture from the centre out
 * instead of in whatever order regions were listed. Nothing here touches the DOM; the page gives
 * it a function that returns an image (or null for a region without one).
 */

import { regionKey } from "./pruneRegion";

export type TileImage = { width: number; height: number; close?: () => void };
export type TileLoader<T extends TileImage> = (rx: number, rz: number) => Promise<T | null>;

export interface WantedRegion {
  rx: number;
  rz: number;
  /** Smaller is nearer the middle of the view and is fetched earlier. */
  priority: number;
}

/** Waits before the second, third and fourth try of a tile whose fetch failed. */
export const RETRY_DELAYS_MS = [1_000, 4_000, 15_000] as const;

export function createTileStore<T extends TileImage>(options: {
  load: TileLoader<T>;
  /** Called when a tile arrives (or turns out to be absent), so the map can redraw. */
  onChange: () => void;
  /** Fetches in flight at once. */
  concurrency?: number;
  /** Tiles kept; past this the oldest ones the view no longer wants are released. */
  maxTiles?: number;
  /** Called once a region has failed every attempt; it is then left without a picture until reset. */
  onError?: (rx: number, rz: number, err: unknown) => void;
  /** Waits before each retry of a failed fetch; one attempt more than there are entries. */
  retryDelaysMs?: readonly number[];
}) {
  const concurrency = options.concurrency ?? 3;
  const maxTiles = options.maxTiles ?? 160;
  const retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS;

  const done = new Map<string, T | "none">();
  const inFlight = new Set<string>();
  /** Regions whose fetch failed: how often, and not before when to ask again. */
  const failed = new Map<string, { count: number; retryAt: number }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const waiting = (key: string): boolean => (failed.get(key)?.retryAt ?? 0) > Date.now();
  let queue: Array<WantedRegion & { key: string }> = [];
  let generation = 0;

  function pump(): void {
    while (inFlight.size < concurrency && queue.length > 0) {
      const next = queue.shift()!;
      if (done.has(next.key) || inFlight.has(next.key)) continue;
      inFlight.add(next.key);
      const mine = generation;
      void options
        .load(next.rx, next.rz)
        .then(
          (image) => {
            if (mine !== generation) {
              image?.close?.();
              return;
            }
            failed.delete(next.key);
            const replaced = done.get(next.key);
            if (replaced && replaced !== "none" && replaced !== image) replaced.close?.();
            done.set(next.key, image ?? "none");
          },
          (err: unknown) => {
            if (mine !== generation) return;
            // A busy wrapper, a proxy timeout or a dropped connection is not "this region has no
            // picture": try again a few times before the region is left plain.
            const count = (failed.get(next.key)?.count ?? 0) + 1;
            const delay = retryDelays[count - 1];
            if (delay === undefined) {
              failed.delete(next.key);
              done.set(next.key, "none");
              options.onError?.(next.rx, next.rz, err);
              return;
            }
            failed.set(next.key, { count, retryAt: Date.now() + delay });
            // The redraw that follows asks for the regions in view again, this one included.
            const timer = setTimeout(() => {
              timers.delete(timer);
              if (mine === generation) options.onChange();
            }, delay);
            timers.add(timer);
          },
        )
        .finally(() => {
          // After a reset this key may already belong to a newer fetch of the same region.
          if (mine !== generation) return;
          inFlight.delete(next.key);
          options.onChange();
          pump();
        });
    }
  }

  function release(wanted: ReadonlySet<string>): void {
    if (done.size <= maxTiles) return;
    for (const [key, value] of done) {
      if (done.size <= maxTiles) break;
      if (wanted.has(key)) continue;
      if (value !== "none") value.close?.();
      done.delete(key);
    }
  }

  return {
    /** The tile if it has arrived, "none" if the region has no picture, null if not known yet. */
    get(rx: number, rz: number): T | "none" | null {
      return done.get(regionKey(rx, rz)) ?? null;
    },

    /** Say which regions the view wants now; ones no longer wanted stop waiting. */
    want(regions: readonly WantedRegion[]): void {
      const wanted = new Set(regions.map((r) => regionKey(r.rx, r.rz)));
      queue = regions
        .map((r) => ({ ...r, key: regionKey(r.rx, r.rz) }))
        .filter((r) => !done.has(r.key) && !inFlight.has(r.key) && !waiting(r.key))
        .sort((a, b) => a.priority - b.priority);
      release(wanted);
      pump();
    },

    /** Forget everything, for another dimension or another plan. Arrivals still in flight are dropped. */
    reset(): void {
      generation++;
      queue = [];
      inFlight.clear();
      for (const value of done.values()) if (value !== "none") value.close?.();
      done.clear();
      failed.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },

    get loading(): number {
      return inFlight.size + queue.length;
    },
  };
}
