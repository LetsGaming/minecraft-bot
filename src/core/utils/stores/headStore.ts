/**
 * Manual head refreshes, one entry per player name in kv_store["playerHeads"].
 * An entry exists only after someone pressed refresh, so the document stays
 * small. The bot and the dashboard read the same row, so a refresh in one
 * shows up in the other.
 */
import { documentStore } from "./versionedStore.js";

export interface HeadRefresh {
  /** Changes on every refresh; part of the head URL. */
  bump: string;
  refreshedAt: number;
  /** Who pressed refresh: a Discord id or a dashboard user id. */
  by: string;
}

interface HeadDoc {
  players: Record<string, HeadRefresh>;
}

/** A name such as "__proto__" is a valid Minecraft name, so the map has no prototype. */
function emptyPlayers(): Record<string, HeadRefresh> {
  return Object.create(null) as Record<string, HeadRefresh>;
}

function isRefresh(value: unknown): value is HeadRefresh {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<HeadRefresh>;
  return typeof v.bump === "string" && typeof v.refreshedAt === "number" && typeof v.by === "string";
}

const headDoc = documentStore<HeadDoc>("playerHeads", (raw) => {
  const players = emptyPlayers();
  const stored = typeof raw === "object" && raw !== null ? (raw as Partial<HeadDoc>).players : undefined;
  if (typeof stored === "object" && stored !== null) {
    for (const [name, entry] of Object.entries(stored)) {
      if (isRefresh(entry)) players[name] = entry;
    }
  }
  return { players };
});

/** The last manual refresh of a player's head, or null when nobody refreshed it. */
export function headInfo(player: string): HeadRefresh | null {
  return headDoc.load().players[player.toLowerCase()] ?? null;
}

/** Records a manual refresh. The next head URL for this player differs from every earlier one. */
export function refreshHead(player: string, by: string, now = Date.now()): HeadRefresh {
  return headDoc.update((doc) => {
    const previous = doc.players[player.toLowerCase()];
    // Two refreshes in the same millisecond must still differ.
    let bump = now.toString(36);
    if (previous?.bump === bump) bump = `${bump}x`;
    const entry: HeadRefresh = { bump, refreshedAt: now, by };
    doc.players[player.toLowerCase()] = entry;
    return entry;
  });
}
