/**
 * Command manifest, how the dashboard (a separate process) knows which
 * commands exist. discord.js and the in-game command registry live in
 * the bot process only, so the bot writes data/commandManifest.json at
 * startup (ALL discovered commands, including currently disabled ones, 
 * a command must be listable to be re-enabled from the UI) and the web
 * backend serves it read-only. Same pattern as the runtime heartbeat.
 */
import path from "path";
import { loadJson, saveJson } from "../jsonStore.js";
import { getRootDir } from "../paths.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";
import { isRecord } from "../objects.js";

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
   * this so its sections mirror the code's own organisation, the mental model
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
const pending: Record<"slash" | "ingame", CommandManifestEntry[]> =
  { slash: [], ingame: [] };

/** Set the commands of one kind. A later call replaces them, so a reload never keeps a removed command. */
export function registerManifestCommands(
  kind: "slash" | "ingame",
  entries: CommandManifestEntry[],
): void {
  pending[kind] = [...entries];
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
  const raw: unknown = await loadJson(MANIFEST_PATH).catch(() => null);
  if (!isRecord(raw) || !Array.isArray(raw["slash"]) || !Array.isArray(raw["ingame"])) {
    return null;
  }
  return {
    slash: raw["slash"].flatMap(toEntry),
    ingame: raw["ingame"].flatMap(toEntry),
    updatedAt: typeof raw["updatedAt"] === "number" ? raw["updatedAt"] : 0,
  };
}

function toEntry(value: unknown): CommandManifestEntry[] {
  if (!isRecord(value) || typeof value["name"] !== "string") return [];
  return [
    {
      name: value["name"],
      description: typeof value["description"] === "string" ? value["description"] : "",
      ...(typeof value["category"] === "string" ? { category: value["category"] } : {}),
    },
  ];
}
