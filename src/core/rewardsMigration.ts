/**
 * One-time upgrade of the reward files to entry ids and exceptions.
 *
 *  - the shared `dailyRewards.json` gets an `id` on every entry,
 *  - each `dailyRewards_<serverId>.json` in the old form (whole fields) is
 *    rewritten as exceptions to the shared pool.
 *
 * A file is only rewritten after the result is proven to resolve to the same
 * rewards as before, and its original bytes are kept next to it as
 * `<file>.pre-exceptions.bak` (first backup wins, so a rerun never replaces the
 * original). Any file that cannot be proven or that has problems of its own is
 * left as it is and reported. Every step is deterministic and every write is
 * atomic, so the bot and the dashboard may both run this at startup.
 */
import { promises as fsPromises } from "fs";
import path from "path";
import {
  isLegacyOverride,
  parseOverridePool,
  parseRewardPool,
  type RewardPool,
} from "@mcbot/schema/dailyRewards.js";
import { convertLegacyVerified, legacyResolve, resolvePool, samePool } from "@mcbot/schema/rewardPatch.js";
import { isEnoent, removeJson, saveJson } from "./utils/jsonStore.js";
import { log } from "./utils/logger.js";
import { errMsg } from "./utils/error.js";
import {
  defaultsPath,
  editableDir,
  ensureSharedRewardsFile,
  formatOverrideDocument,
  formatRewardsDocument,
  readText,
  sharedRewardsPath,
  withEntryIds,
} from "./utils/stores/rewardsConfig.js";
import type { OverridePool } from "@mcbot/schema/dailyRewards.js";

export const REWARDS_BACKUP_SUFFIX = ".pre-exceptions.bak";

export type MigrationAction = "unchanged" | "migrated" | "removed" | "skipped" | "failed";

export interface MigrationFileResult {
  file: string;
  action: MigrationAction;
  detail?: string;
  /** An override that was an exact copy of the shared pool and now follows it. */
  followsShared?: boolean;
}

export interface MigrationReport {
  dryRun: boolean;
  files: MigrationFileResult[];
}

function hasMissingIds(pool: RewardPool): boolean {
  const lists = [pool.default ?? [], ...Object.values(pool.streakBonuses ?? {})];
  return lists.some((list) => list.some((entry) => entry.id === undefined));
}

/** Keep the original bytes; a backup that already exists is the older original. */
async function backUp(file: string, text: string): Promise<void> {
  try {
    await fsPromises.writeFile(file + REWARDS_BACKUP_SUFFIX, text, { flag: "wx" });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EEXIST") return;
    throw err;
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

async function migrateShared(
  dryRun: boolean,
  files: MigrationFileResult[],
): Promise<RewardPool | null> {
  const file = sharedRewardsPath();
  const name = path.basename(file);
  const text = (await readText(file)) ?? (dryRun ? await readText(defaultsPath()) : null);
  if (text === null) {
    files.push({ file: name, action: "skipped", detail: "there is no shared pool yet" });
    return null;
  }
  const json = parseJson(text);
  if (!json.ok) {
    files.push({ file: name, action: "skipped", detail: `not valid JSON (${json.error})` });
    return null;
  }
  const { pool, errors } = parseRewardPool(json.value, "shared");
  if (errors.length > 0) {
    files.push({ file: name, action: "skipped", detail: `${errors.length} problem(s) to fix first, entries get their ids on the next save` });
    return withEntryIds(pool);
  }
  const next = withEntryIds(pool);
  if (!hasMissingIds(pool)) {
    files.push({ file: name, action: "unchanged" });
    return next;
  }
  const reread = parseRewardPool(JSON.parse(formatRewardsDocument(next)) as unknown, "shared");
  if (reread.errors.length > 0 || !samePool(reread.pool, pool)) {
    files.push({ file: name, action: "failed", detail: "the ids could not be added without changing the rewards" });
    return next;
  }
  if (!dryRun && (await readText(file)) !== null) {
    await backUp(file, text);
    await saveJson(file, next, (d) => formatRewardsDocument(d as RewardPool));
  }
  files.push({ file: name, action: "migrated", detail: "ids added" });
  return next;
}

async function migrateOverride(
  file: string,
  shared: RewardPool,
  dryRun: boolean,
): Promise<MigrationFileResult> {
  const name = path.basename(file);
  const text = await readText(file);
  if (text === null) return { file: name, action: "skipped", detail: "the file is gone" };
  const json = parseJson(text);
  if (!json.ok) return { file: name, action: "skipped", detail: `not valid JSON (${json.error})` };
  if (!isLegacyOverride(json.value)) {
    const { errors } = parseOverridePool(json.value);
    return errors.length > 0
      ? { file: name, action: "skipped", detail: `${errors.length} problem(s) in the file` }
      : { file: name, action: "unchanged" };
  }

  const legacy = parseRewardPool(json.value, "override");
  if (legacy.errors.length > 0) {
    return { file: name, action: "skipped", detail: `${legacy.errors.length} problem(s) to fix first, rewriting would drop entries` };
  }
  const patch = convertLegacyVerified(shared, legacy.pool);
  if (!patch) return { file: name, action: "failed", detail: "the exceptions could not be proven equal to the old override" };

  const empty = Object.keys(patch).length === 0;
  if (dryRun) {
    return { file: name, action: empty ? "removed" : "migrated", followsShared: empty };
  }

  await backUp(file, text);
  if (empty) {
    await removeJson(file);
    return { file: name, action: "removed", followsShared: true, detail: "it was a copy of the shared rewards" };
  }
  await saveJson(file, patch, (d) => formatOverrideDocument(d as OverridePool));

  // The proof again, from what is on disk now.
  const written = parseJson((await readText(file)) ?? "");
  const reread = written.ok ? parseOverridePool(written.value) : null;
  const ok =
    reread !== null &&
    reread.errors.length === 0 &&
    samePool(resolvePool(shared, reread.pool).pool, legacyResolve(shared, legacy.pool));
  if (!ok) {
    await fsPromises.writeFile(file, text);
    return { file: name, action: "failed", detail: "the written file did not match, the original was restored" };
  }
  return { file: name, action: "migrated" };
}

/**
 * Upgrade every reward file. With `dryRun` nothing is written and the report
 * says what would happen. Never throws for a bad file; each is reported.
 */
export async function migrateRewardFiles(options: { dryRun?: boolean } = {}): Promise<MigrationReport> {
  const dryRun = options.dryRun === true;
  const files: MigrationFileResult[] = [];
  if (!dryRun) await ensureSharedRewardsFile();

  const shared = await migrateShared(dryRun, files);
  if (shared === null) return { dryRun, files };

  let names: string[] = [];
  try {
    names = await fsPromises.readdir(editableDir());
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
  for (const name of names.filter((n) => /^dailyRewards_.+\.json$/.test(n)).sort()) {
    try {
      files.push(await migrateOverride(path.join(editableDir(), name), shared, dryRun));
    } catch (err) {
      files.push({ file: name, action: "failed", detail: errMsg(err) });
    }
  }
  return { dryRun, files };
}

/** Run the upgrade at startup. A problem is logged; it never stops the process. */
export async function runRewardsMigration(): Promise<MigrationReport | null> {
  try {
    const report = await migrateRewardFiles();
    for (const result of report.files) {
      if (result.action === "unchanged") continue;
      const line = `rewards migration: ${result.file} ${result.action}${result.detail ? ` (${result.detail})` : ""}`;
      if (result.action === "failed") log.error("daily", line);
      else if (result.action === "skipped") log.warn("daily", line);
      else log.info("daily", line);
    }
    return report;
  } catch (err) {
    log.error("daily", `rewards migration could not run: ${errMsg(err)}`);
    return null;
  }
}
