/**
 * The terrain tiles the prune map draws under its classes: which regions are being fetched, which
 * have arrived, and which turned out to have none. Fetching is limited to a few at a time and goes
 * nearest the middle of the view first, so a zoom or a drag fills the picture from the centre out
 * instead of in whatever order regions were listed. Nothing here touches the DOM; the page gives
 * it a function that returns an image (or null for a region without one).
 */

export type TileImage = { width: number; height: number; close?: () => void };
export type TileLoader<T extends TileImage> = (rx: number, rz: number) => Promise<T | null>;

export interface WantedRegion {
  rx: number;
  rz: number;
  /** Smaller is nearer the middle of the view and is fetched earlier. */
  priority: number;
}

const keyOf = (rx: number, rz: number): string => `${rx},${rz}`;

export function createTileStore<T extends TileImage>(options: {
  load: TileLoader<T>;
  /** Called when a tile arrives (or turns out to be absent), so the map can redraw. */
  onChange: () => void;
  /** Fetches in flight at once. */
  concurrency?: number;
  /** Tiles kept; past this the ones furthest from what is wanted are released. */
  maxTiles?: number;
  /** Called with an error that is not "no such tile"; the region is then not retried until reset. */
  onError?: (rx: number, rz: number, err: unknown) => void;
}) {
  const concurrency = options.concurrency ?? 3;
  const maxTiles = options.maxTiles ?? 160;

  const done = new Map<string, T | "none">();
  const inFlight = new Set<string>();
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
            done.set(next.key, image ?? "none");
          },
          (err: unknown) => {
            if (mine !== generation) return;
            done.set(next.key, "none");
            options.onError?.(next.rx, next.rz, err);
          },
        )
        .finally(() => {
          inFlight.delete(next.key);
          if (mine === generation) {
            options.onChange();
            pump();
          }
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
      return done.get(keyOf(rx, rz)) ?? null;
    },

    /** Say which regions the view wants now; ones no longer wanted stop waiting. */
    want(regions: readonly WantedRegion[]): void {
      const wanted = new Set(regions.map((r) => keyOf(r.rx, r.rz)));
      queue = regions
        .map((r) => ({ ...r, key: keyOf(r.rx, r.rz) }))
        .filter((r) => !done.has(r.key) && !inFlight.has(r.key))
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
    },

    get loading(): number {
      return inFlight.size + queue.length;
    },
  };
}
