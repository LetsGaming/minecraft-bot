/**
 * The /list counts as numbers. The wrapper sends both as strings, and
 * `maxPlayers` is "?" when the server did not report it; either one can also
 * be a shape we do not understand. A count that cannot be read is null, never
 * 0, so "unknown" stays distinct from "empty".
 */
export interface PlayerCounts {
  online: number | null;
  max: number | null;
}

function parseCount(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

export function parsePlayerCounts(list: {
  playerCount: unknown;
  maxPlayers: unknown;
}): PlayerCounts {
  return { online: parseCount(list.playerCount), max: parseCount(list.maxPlayers) };
}
