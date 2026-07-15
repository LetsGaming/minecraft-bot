/**
 * Filesystem locations the runtime derives everything else from.
 *
 * Split out of the old `utils.ts` grab-bag: this is the one place that
 * answers "where is the project root" and "does this file's directory
 * exist yet", with no domain knowledge attached.
 */
import { promises as fsPromises, existsSync, readFileSync } from "fs";
import path from "path";

/**
 * Project root: the nearest ancestor whose package.json declares
 * "workspaces" (the monorepo root), falling back to the nearest
 * package.json at all (packed single-app deploys), then to cwd.
 *
 * cwd-based on purpose — every supported entry point (npm scripts, the
 * PM2 ecosystem cwd, Docker WORKDIR /app) runs from the repo root, where
 * config.json and data/ live. The workspaces preference exists for the
 * dev who runs a one-off script from inside bot/ or packages/core/: the
 * nearest package.json would be the workspace's own, but the data still
 * lives at the root.
 */
export function getRootDir(): string {
  let dir = process.cwd();
  let firstPkgDir: string | null = null;
  while (true) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      firstPkgDir ??= dir;
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf-8")) as {
          workspaces?: unknown;
        };
        if (parsed.workspaces) return dir;
      } catch {
        /* unreadable manifest is still a location candidate */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return firstPkgDir ?? process.cwd();
}

/** Ensure the directory holding `filePath` exists; returns that directory. */
export async function ensureDir(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}
