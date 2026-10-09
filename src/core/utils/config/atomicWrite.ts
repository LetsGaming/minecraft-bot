import fs from "fs";

/**
 * Replace `filePath` with `data` via a temp file in the same directory and a
 * rename, so a crash never leaves a truncated file. The temp file is removed
 * if anything fails.
 */
export function writeFileAtomicSync(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
