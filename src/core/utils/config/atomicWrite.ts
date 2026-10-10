import crypto from "crypto";
import fs from "fs";

/** Owner-only: the config holds the Discord token and wrapper API keys. */
export const SECRET_FILE_MODE = 0o600;

/**
 * The mode a replacement of `filePath` must keep. An existing file's own
 * permissions win so an operator's choice survives a rewrite; a new file is
 * owner-only.
 */
export function existingFileMode(filePath: string): number {
  try {
    return fs.statSync(filePath).mode & 0o777;
  } catch {
    return SECRET_FILE_MODE;
  }
}

/** A temp path next to `filePath` that nothing else can have created. */
export function tempSiblingPath(filePath: string): string {
  return `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
}

/**
 * Replace `filePath` with `data` via a temp file in the same directory and a
 * rename, so a crash never leaves a truncated file. The temp file is created
 * exclusively with the destination's mode and removed if anything fails.
 */
export function writeFileAtomicSync(filePath: string, data: string): void {
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
