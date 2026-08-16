/**
 * Finding command modules on disk, once.
 *
 * Both startup paths — the slash loader in `bot/index.ts` and the in-game
 * loader in `logWatcher/initMinecraftCommands.ts` — walk a `commands/` tree
 * and derive a category from each file's folder. They had a copy each, and the
 * copies had already drifted: one excluded `middleware.js` and the other did
 * not. That difference was harmless only because the in-game tree happens to
 * contain no `middleware.js` — precisely the kind of latent divergence that
 * makes duplicated logic a liability rather than a convenience.
 *
 * This is bot-only: it reads the filesystem synchronously at startup, so it
 * lives in the bot package rather than `@mcbot/core`. Core is isomorphic and
 * importable by the browser frontend, and pulling `node:fs` into it would
 * break that boundary for no benefit — the dashboard never enumerates command
 * files.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Every compiled command module under `dir`, recursively.
 *
 * `middleware.js` is excluded everywhere: it is the slash wrapper, not a
 * command, and the slash loader used to filter it out by hand while the
 * in-game loader did not. Excluding it unconditionally is correct for both —
 * a file named `middleware.js` is never a command — and removes the one line
 * the two copies disagreed on.
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
