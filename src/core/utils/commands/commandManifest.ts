/**
 * Command manifest — how the dashboard (a separate process) knows which
 * commands exist. discord.js and the in-game command registry live in
 * the bot process only, so the bot writes data/commandManifest.json at
 * startup (ALL discovered commands, including currently disabled ones —
 * a command must be listable to be re-enabled from the UI) and the web
 * backend serves it read-only. Same pattern as the runtime heartbeat.
 */
import path from "path";
import { loadJson, saveJson } from "../jsonStore.js";
import { getRootDir } from "../paths.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";

const MANIFEST_PATH = path.resolve(
  getRootDir(),
  "data",
  "commandManifest.json",
);

export interface CommandManifestEntry {
  name: string;
  description: string;
  /**
   * The command's source folder under `commands/` (slash) or its declared
   * group (in-game), e.g. "connection", "moderation". The dashboard groups by
   * this so its sections mirror the code's own organisation — the mental model
   * someone has from the repo is the one they get in the UI. Optional so an
   * older manifest on disk still loads; the dashboard treats a missing value
   * as an "Other" bucket rather than failing.
   */
  category?: string;
}

export interface CommandManifest {
  /** Slash commands (scope: guilds). */
  slash: CommandManifestEntry[];
  /** In-game !commands (scope: servers). */
  ingame: CommandManifestEntry[];
  updatedAt: number;
}

// Accumulated during startup: bot/index contributes the slash half,
// initMinecraftCommands the in-game half, then one flush writes the file.
const pending: { slash: CommandManifestEntry[]; ingame: CommandManifestEntry[] } =
  { slash: [], ingame: [] };

export function registerManifestCommands(
  kind: "slash" | "ingame",
  entries: CommandManifestEntry[],
): void {
  pending[kind].push(...entries);
}

export async function flushCommandManifest(): Promise<void> {
  try {
    const sort = (a: CommandManifestEntry, b: CommandManifestEntry): number =>
      a.name.localeCompare(b.name);
    const dedupe = (list: CommandManifestEntry[]): CommandManifestEntry[] => {
      const seen = new Map<string, CommandManifestEntry>();
      for (const entry of list) seen.set(entry.name, entry);
      return [...seen.values()].sort(sort);
    };
    await saveJson(MANIFEST_PATH, {
      slash: dedupe(pending.slash),
      ingame: dedupe(pending.ingame),
      updatedAt: Date.now(),
    } satisfies CommandManifest);
  } catch (err) {
    log.warn("commands", `Manifest write failed: ${errMsg(err)}`);
  }
}

/** Read side for the dashboard; null when the bot never wrote one. */
export async function readCommandManifest(): Promise<CommandManifest | null> {
  const raw = (await loadJson(MANIFEST_PATH).catch(() => null)) as
    | Partial<CommandManifest>
    | null;
  if (!raw || !Array.isArray(raw.slash) || !Array.isArray(raw.ingame)) {
    return null;
  }
  return {
    slash: raw.slash,
    ingame: raw.ingame,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}
