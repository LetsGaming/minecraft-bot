/**
 * Finding command modules on disk, once.
 *
 * Both startup paths, the slash loader in bot/index.ts and the in-game loader
 * in logWatcher/initMinecraftCommands.ts, walk a commands/ tree, derive a
 * category from each file's folder and detect duplicate names through
 * discoverModules.
 *
 * This is bot-only: it reads the filesystem synchronously at startup, so it
 * lives in the bot package rather than @mcbot/core. Core is isomorphic and
 * importable by the browser frontend, and the dashboard never enumerates
 * command files.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

/**
 * Every compiled command module under `dir`, recursively. `middleware.js` is
 * never a command (it is the slash wrapper), so it is excluded.
 */
export function getCommandFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files = files.concat(getCommandFiles(full));
    } else if (entry.endsWith(".js") && entry !== "middleware.js") {
      files.push(full);
    }
  }
  return files;
}

/**
 * A command's category: its first folder under the commands root.
 *
 * `commands/connection/daily/daily.js` → "connection". A file sitting directly
 * in `commands/` has no folder and returns "", which the dashboard renders as
 * an "Other" group rather than a blank header. The dashboard groups by this so
 * its sections mirror the repository's own layout.
 */
export function categoryOf(root: string, file: string): string {
  const rel = path.relative(root, file);
  const parts = rel.split(path.sep);
  return parts.length > 1 ? parts[0]! : "";
}

/**
 * Import a command module by file path. Dynamic `import()` takes a URL, so a
 * raw Windows path such as `C:\bot\x.js` is read as a `c:` scheme and fails.
 */
export function importCommandModule(file: string): Promise<unknown> {
  return import(pathToFileURL(path.resolve(file)).href);
}

/** What a command module declares about itself, once validated. */
export interface ModuleIdentity<T> {
  /** The name the command is dispatched and enabled by. */
  name: string;
  description: string;
  value: T;
}

export interface DiscoveredModule<T> extends ModuleIdentity<T> {
  file: string;
  /** First folder under the root, "" for a file directly in it. */
  category: string;
}

/** The dashboard's view of one command a loader found. */
export interface ManifestEntry {
  name: string;
  description: string;
  category: string;
}

/**
 * Import every command module under `root` and keep the ones `identify`
 * accepts (null skips a file that is not a command). A file that fails to
 * import is logged and skipped. Two files claiming one name is always a bug,
 * usually stale build output (tsc leaves a renamed file's old .js behind), so
 * the second is refused. Enablement and capability skips stay with the caller:
 * the manifest must list disabled commands too, so they can be re-enabled
 * from the dashboard.
 */
export async function discoverModules<T>(
  root: string,
  kind: string,
  identify: (mod: unknown, file: string) => ModuleIdentity<T> | null,
): Promise<DiscoveredModule<T>[]> {
  const found = new Map<string, DiscoveredModule<T>>();
  for (const file of getCommandFiles(root)) {
    try {
      const identity = identify(await importCommandModule(file), file);
      if (!identity) continue;
      const first = found.get(identity.name);
      if (first) {
        log.warn(
          "commands",
          `Ignoring duplicate ${kind} command ${identity.name} from ${file}, already ` +
            `loaded from ${first.file}. If one of those is stale build output, run ` +
            `'npm run clean' and rebuild.`,
        );
        continue;
      }
      found.set(identity.name, { ...identity, file, category: categoryOf(root, file) });
    } catch (err) {
      log.error("commands", `Failed to load ${file}: ${errMsg(err)}`);
    }
  }
  return [...found.values()];
}

export function manifestOf<T>(modules: readonly DiscoveredModule<T>[]): ManifestEntry[] {
  return modules.map(({ name, description, category }) => ({ name, description, category }));
}

/** Startup guard: a bot that registered no slash commands is misconfigured, not idle. */
export function assertCommandsLoaded(count: number, root: string): void {
  if (count === 0) {
    throw new Error(
      `No slash commands loaded from ${root}. Check that the project is built (npm run build) and the commands directory exists.`,
    );
  }
}
