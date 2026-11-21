/**
 * What the bot remembers about player heads, in kv_store["playerHeads"]: manual
 * refreshes and the skin hash last read from Mojang, one entry per player name.
 * The bot and the dashboard read the same row, so a change in one shows up in
 * the other. An entry exists only for a player who was refreshed or checked, so
 * the document stays small.
 */
import { documentStore } from "./versionedStore.js";

export interface HeadRefresh {
  /** Changes on every refresh; part of the head URL. */
  bump: string;
  refreshedAt: number;
  /** Who pressed refresh: a Discord id or a dashboard user id. */
  by: string;
}

export interface SkinRecord {
  /** Hash of the current skin texture, or null for a default skin or an account Mojang does not know. */
  hash: string | null;
  /** When Mojang last answered for this player; 0 when it never did. */
  checkedAt: number;
  /** When the last attempt failed, so a failing lookup is not retried at once. */
  failedAt?: number;
}

interface HeadDoc {
  players: Record<string, HeadRefresh>;
  skins: Record<string, SkinRecord>;
}

/** A name such as "__proto__" is a valid Minecraft name, so the maps have no prototype. */
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function isRefresh(value: unknown): value is HeadRefresh {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<HeadRefresh>;
  return typeof v.bump === "string" && typeof v.refreshedAt === "number" && typeof v.by === "string";
}

function isSkinRecord(value: unknown): value is SkinRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SkinRecord>;
  return (
    (v.hash === null || typeof v.hash === "string") &&
    typeof v.checkedAt === "number" &&
    (v.failedAt === undefined || typeof v.failedAt === "number")
  );
}

function readMap<T>(stored: unknown, valid: (v: unknown) => v is T): Record<string, T> {
  const map = emptyMap<T>();
  if (typeof stored === "object" && stored !== null) {
    for (const [name, entry] of Object.entries(stored)) {
      if (valid(entry)) map[name] = entry;
    }
  }
  return map;
}

const headDoc = documentStore<HeadDoc>("playerHeads", (raw) => {
  const doc = typeof raw === "object" && raw !== null ? (raw as Partial<HeadDoc>) : {};
  return { players: readMap(doc.players, isRefresh), skins: readMap(doc.skins, isSkinRecord) };
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

/** Everything the head URL of one player depends on, from one read. */
export function headKeys(player: string): { hash: string | null; bump: string | null } {
  const doc = headDoc.load();
  const key = player.toLowerCase();
  return { hash: doc.skins[key]?.hash ?? null, bump: doc.players[key]?.bump ?? null };
}

/** The stored skin check of a player, or null when none was made. */
export function getSkin(player: string): SkinRecord | null {
  return headDoc.load().skins[player.toLowerCase()] ?? null;
}

/** Stores what Mojang said about a player's skin. Clears an earlier failure. */
export function setSkin(player: string, hash: string | null, now = Date.now()): void {
  headDoc.update((doc) => {
    doc.skins[player.toLowerCase()] = { hash, checkedAt: now };
  });
}

/** Notes a failed lookup and keeps whatever hash was stored before. */
export function markSkinFailed(player: string, now = Date.now()): void {
  headDoc.update((doc) => {
    const key = player.toLowerCase();
    const previous = doc.skins[key];
    doc.skins[key] = { hash: previous?.hash ?? null, checkedAt: previous?.checkedAt ?? 0, failedAt: now };
  });
}

/** Drops the skin entries of every player not in `keep`; returns how many were dropped. */
export function pruneSkins(keep: Iterable<string>): number {
  const wanted = new Set([...keep].map((name) => name.toLowerCase()));
  return headDoc.update((doc) => {
    let dropped = 0;
    for (const key of Object.keys(doc.skins)) {
      if (wanted.has(key)) continue;
      delete doc.skins[key];
      dropped += 1;
    }
    return dropped;
  });
}
