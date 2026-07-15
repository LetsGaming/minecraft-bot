/**
 * Read/write helpers for the remaining human-authored JSON on disk.
 *
 * Machine-written state moved to SQLite in v4.0 (see db/index.ts's
 * ownership rule); what still comes through here is config.json,
 * dailyRewards.json, and the two small files the bot publishes for the
 * dashboard process (runtime.json, commandManifest.json).
 *
 * Split out of the old `utils.ts` grab-bag. The durability dance below —
 * cache by mtime, write-then-rename, keep a .bak, refuse to silently
 * return `{}` for a corrupt file — is the reason this is a module rather
 * than a `readFile`/`writeFile` at each call site.
 */
import { promises as fsPromises } from "fs";
import path from "path";
import { ensureDir } from "./paths.js";
import { log } from "./logger.js";
import type { JsonCacheEntry } from "../types/index.js";

const jsonCache = new Map<string, JsonCacheEntry>();
const writeLocks = new Map<string, Promise<void>>();

function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

/**
 * Load a JSON store.
 *
 * A missing file just means "first run" and yields an empty store. Anything
 * else (truncated file, bad permissions, corrupt JSON) must not be turned
 * into `{}` — the next save would overwrite what's left on disk and make
 * the loss permanent. So: log, try the `.bak` copy, throw if that fails too.
 */
export async function loadJson(file: string): Promise<unknown> {
  try {
    const { mtimeMs } = await fsPromises.stat(file);
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;
    const raw = await fsPromises.readFile(file, "utf-8");
    const data: unknown = JSON.parse(raw);
    jsonCache.set(file, { mtimeMs, data });
    return data;
  } catch (err) {
    if (isEnoent(err)) return {};

    const reason = err instanceof Error ? err.message : String(err);
    const base = path.basename(file);
    log.error(
      "storage",
      `Failed to read ${file}: ${reason} — attempting recovery from ${base}.bak`,
    );

    try {
      const raw = await fsPromises.readFile(`${file}.bak`, "utf-8");
      const data: unknown = JSON.parse(raw);
      log.warn(
        "storage",
        `Recovered ${base} from last-known-good backup; the next save will repair the main file.`,
      );
      // Not cached: the main file's mtime still identifies the corrupt
      // content. The next save rewrites the file and refreshes the cache.
      return data;
    } catch {
      throw new Error(
        `${file} is corrupt or unreadable (${reason}) and no usable .bak ` +
          `backup exists. Refusing to continue with empty data — restore ` +
          `the file from a backup, or delete it (and its .bak) to ` +
          `intentionally start fresh.`,
      );
    }
  }
}

/** Write a JSON store atomically, keeping a last-known-good `.bak` beside it. */
export async function saveJson(file: string, data: unknown): Promise<void> {
  const prev = writeLocks.get(file) ?? Promise.resolve();
  const next = prev.then(async () => {
    await ensureDir(file);
    const json = JSON.stringify(data, null, 2);

    // Write-then-rename: an interrupted in-place write leaves a truncated
    // file, while rename(2) is atomic — readers see old or new, never half.
    const tmp = `${file}.tmp`;
    await fsPromises.writeFile(tmp, json);
    await fsPromises.rename(tmp, file);

    const { mtimeMs } = await fsPromises.stat(file);
    jsonCache.set(file, { mtimeMs, data });

    // Last-known-good copy for loadJson's recovery path, same tmp+rename
    // dance. Best-effort — a failed backup must not fail the save.
    try {
      const bakTmp = `${file}.bak.tmp`;
      await fsPromises.writeFile(bakTmp, json);
      await fsPromises.rename(bakTmp, `${file}.bak`);
    } catch (bakErr) {
      const reason = bakErr instanceof Error ? bakErr.message : String(bakErr);
      log.warn(
        "storage",
        `Could not write backup for ${path.basename(file)}: ${reason}`,
      );
    }
  });
  writeLocks.set(
    file,
    next.catch(() => {}),
  );
  return next;
}
