/**
 * Admin notes on players — single owner of data/playerNotes.json.
 *
 * Keyed by Minecraft UUID so notes survive name changes (playerUtils
 * already resolves UUIDs from the whitelist/usercache); each entry keeps
 * the last known name for display and name-based fallback lookups.
 *
 * Deliberately thin — annotations only, which respects the roadmap's
 * "no ban database of its own" boundary. Every mutation is audited by the
 * /note command via recordAdminAction.
 */
import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";

const NOTES_PATH = path.resolve(getRootDir(), "data", "playerNotes.json");

/** Keep the newest N notes per player — moderation memory, not a ledger. */
export const MAX_NOTES_PER_PLAYER = 25;

export interface PlayerNote {
  text: string;
  author: string;
  authorId: string;
  /** Human-readable timestamp (formatDatetime), same as adminAudit. */
  createdAt: string;
}

export interface PlayerNotesEntry {
  /** Last known name at note time, for display + fallback lookup. */
  name: string;
  notes: PlayerNote[];
}

export interface PlayerNotesStore {
  version: 1;
  /** Minecraft UUID → entry */
  players: Record<string, PlayerNotesEntry>;
}

function isV1Store(raw: unknown): raw is PlayerNotesStore {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 1 &&
    typeof (raw as { players?: unknown }).players === "object" &&
    (raw as { players?: unknown }).players !== null
  );
}

export async function loadNotesStore(): Promise<PlayerNotesStore> {
  const raw = await loadJson(NOTES_PATH);
  if (isV1Store(raw)) return raw;
  return { version: 1, players: {} };
}

export async function saveNotesStore(store: PlayerNotesStore): Promise<void> {
  return saveJson(NOTES_PATH, store);
}

export function addNote(
  store: PlayerNotesStore,
  uuid: string,
  name: string,
  note: PlayerNote,
): void {
  const entry = (store.players[uuid] ??= { name, notes: [] });
  entry.name = name;
  entry.notes = [...entry.notes, note].slice(-MAX_NOTES_PER_PLAYER);
}

/** Remove the 1-based index shown by /note list. False when out of range. */
export function removeNote(
  store: PlayerNotesStore,
  uuid: string,
  index: number,
): boolean {
  const entry = store.players[uuid];
  if (!entry || index < 1 || index > entry.notes.length) return false;
  entry.notes.splice(index - 1, 1);
  if (entry.notes.length === 0) delete store.players[uuid];
  return true;
}

export function getNotesByUuid(
  store: PlayerNotesStore,
  uuid: string,
): PlayerNotesEntry | null {
  return store.players[uuid] ?? null;
}

/**
 * Name-based fallback for callers without a UUID (e.g. /whois when the
 * whitelist audit has none). Case-insensitive on the stored last-known
 * name; returns the first match.
 */
export function findNotesByName(
  store: PlayerNotesStore,
  name: string,
): { uuid: string; entry: PlayerNotesEntry } | null {
  const lower = name.toLowerCase();
  for (const [uuid, entry] of Object.entries(store.players)) {
    if (entry.name.toLowerCase() === lower) return { uuid, entry };
  }
  return null;
}
