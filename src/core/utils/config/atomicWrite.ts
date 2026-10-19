import crypto from "crypto";
import fs from "fs";
import path from "path";
import { MS } from "@mcbot/schema/time.js";

/** Owner-only: the config holds the Discord token and wrapper API keys. */
export const SECRET_FILE_MODE = 0o600;

const STALE_TEMP_MS = 10 * MS.minute;
const TEMP_NAME = /\.\d+\.[0-9a-f]{12}\.tmp$/;

/**
 * The mode a replacement of `filePath` must keep. An existing file's owner and
 * group permissions survive a rewrite, but the "other" bits never do, so a
 * config is never carried over as world-accessible. A new file is owner-only.
 */
export function existingFileMode(filePath: string): number {
  try {
    return fs.statSync(filePath).mode & 0o770;
  } catch {
    return SECRET_FILE_MODE;
  }
}

/** A temp path next to `filePath` that nothing else can have created. */
export function tempSiblingPath(filePath: string): string {
  return `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
}

/**
 * Remove temp files a crashed write left next to `filePath`. They carry the
 * full config, secrets included, and their random names mean no later write
 * would overwrite them.
 */
export function sweepStaleTemps(filePath: string, now = Date.now()): void {
  const dir = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !TEMP_NAME.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_TEMP_MS) fs.rmSync(full);
    } catch {
      // gone already, or still in use by another writer
    }
  }
}

/**
 * Replace `filePath` with `data` via a temp file in the same directory and a
 * rename, so a crash never leaves a truncated file. The temp file is created
 * exclusively with the destination's mode and removed if anything fails.
 */
export function writeFileAtomicSync(filePath: string, data: string): void {
  sweepStaleTemps(filePath);
  const tmp = tempSiblingPath(filePath);
  try {
    fs.writeFileSync(tmp, data, {
      mode: existingFileMode(filePath),
      flag: "wx",
    });
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Async `writeFileAtomicSync`. `beforeRename` runs once the temp file is
 * fully written and before it replaces `filePath`: the place to keep a backup
 * of the old content, since a failure there leaves the original untouched.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string,
  beforeRename?: () => Promise<void>,
): Promise<void> {
  sweepStaleTemps(filePath);
  const tmp = tempSiblingPath(filePath);
  try {
    await fs.promises.writeFile(tmp, data, {
      mode: existingFileMode(filePath),
      flag: "wx",
    });
    await beforeRename?.();
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
