/**
 * The daily-reward documents on disk, for the bot's `/daily` and for the
 * dashboard's rewards editor.
 *
 *   data/dailyRewards.defaults.json   shipped with the bot, git-tracked, never written
 *   data/dailyRewards.json            the shared pool, copied from the defaults on first use
 *   data/dailyRewards_<serverId>.json one server's exceptions to the shared pool
 *
 * The shared pool is a copy rather than the tracked file itself so that
 * editing it, by hand or from the dashboard, never collides with an update
 * of the shipped defaults.
 *
 * Both processes read these through loadJson's mtime cache, so a save from
 * the dashboard reaches the bot's next `/daily` without a restart.
 */
import { createHash } from "crypto";
import { constants as fsConstants, promises as fsPromises } from "fs";
import path from "path";
import {
  assignIds,
  isLegacyOverride,
  parseOverridePool,
  parseRewardPool,
  type DailyRewardItem,
  type ListPatch,
  type OverridePool,
  type RewardPool,
  type RewardPoolField,
} from "@mcbot/schema/dailyRewards.js";
import { compactOverride, convertLegacyVerified, resolvePool } from "@mcbot/schema/rewardPatch.js";
import { isEnoent, loadJson, removeJson, saveJson } from "../jsonStore.js";
import { getRootDir } from "../paths.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";
import type { DailyRewardsConfig } from "../../types/index.js";

function dataDir(): string {
  return path.resolve(getRootDir(), "data");
}

/**
 * Where the editable reward files live. MCBOT_REWARDS_DIR moves them out of
 * data/ (dev-up.mjs points it at the session's own folder, so a dev session
 * never edits the repo's real pool); the shipped defaults stay in data/.
 */
export function editableDir(): string {
  const override = process.env.MCBOT_REWARDS_DIR;
  return override ? path.resolve(override) : dataDir();
}

export function defaultsPath(): string {
  return path.join(dataDir(), "dailyRewards.defaults.json");
}

export function sharedRewardsPath(): string {
  return path.join(editableDir(), "dailyRewards.json");
}

export function serverRewardsPath(serverId: string): string {
  return path.join(editableDir(), `dailyRewards_${serverId}.json`);
}

/**
 * Create data/dailyRewards.json from the shipped defaults when it does not
 * exist yet. COPYFILE_EXCL makes this safe when the bot and the dashboard
 * both start at once: the second copy fails with EEXIST and is ignored.
 */
export async function ensureSharedRewardsFile(): Promise<void> {
  try {
    await fsPromises.access(sharedRewardsPath());
    return;
  } catch {
    // missing, seed it below
  }
  try {
    await fsPromises.copyFile(defaultsPath(), sharedRewardsPath(), fsConstants.COPYFILE_EXCL);
    log.info("daily", `Created ${sharedRewardsPath()} from the shipped defaults.`);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EEXIST") return;
    if (isEnoent(err)) {
      log.warn("daily", "No data/dailyRewards.defaults.json to seed the reward pool from.");
      return;
    }
    log.error("daily", `Could not create ${sharedRewardsPath()}: ${errMsg(err)}`);
  }
}

// Problems are logged once per distinct set, not on every claim.
const reported = new Map<string, string>();

function reportProblems(file: string, errors: string[]): void {
  const key = errors.join("\n");
  if (reported.get(file) === key) return;
  reported.set(file, key);
  if (errors.length === 0) return;
  log.warn(
    "daily",
    `${path.basename(file)}: ${errors.length} problem(s), the invalid entries are skipped:\n  ` +
      errors.join("\n  "),
  );
}

/** The shared pool, with invalid entries dropped (and logged). */
export async function loadDailyRewardsConfig(): Promise<DailyRewardsConfig> {
  await ensureSharedRewardsFile();
  const file = sharedRewardsPath();
  const { pool, errors } = parseRewardPool(await loadJson(file), "shared");
  reportProblems(file, errors);
  return { ...pool, default: pool.default ?? [] };
}

/** The shared pool with every entry carrying the id it resolves to. */
export function withEntryIds(pool: RewardPool): RewardPool {
  const out: RewardPool = { ...pool };
  if (pool.default) out.default = assignIds(pool.default);
  if (pool.streakBonuses) {
    out.streakBonuses = Object.fromEntries(
      Object.entries(pool.streakBonuses).map(([day, list]) => [day, assignIds(list)]),
    );
  }
  return out;
}

/**
 * Read an override file's content as exceptions. A file still in the old form
 * (whole fields) is converted here, so every state between "upgraded" and
 * "migrated" resolves to the rewards the server had before. The conversion is
 * proven against the old meaning; when it cannot be, the override is left out
 * rather than guessed.
 */
function overrideFromRaw(
  raw: unknown,
  shared: RewardPool,
  file: string,
): { pool: OverridePool | undefined; errors: string[] } {
  if (isLegacyOverride(raw)) {
    const legacy = parseRewardPool(raw, "override");
    if (legacy.errors.length > 0) return { pool: undefined, errors: legacy.errors };
    const patch = convertLegacyVerified(withEntryIds(shared), legacy.pool);
    if (!patch) {
      log.error("daily", `${path.basename(file)}: could not read the old override format safely, using the shared rewards.`);
      return { pool: undefined, errors: [] };
    }
    log.warn("daily", `${path.basename(file)} is in the old format; it is read as exceptions. Restart to migrate it.`);
    return { pool: patch, errors: [] };
  }
  const { pool, errors } = parseOverridePool(raw);
  return { pool: compactOverride(pool), errors };
}

/** A server's exceptions to the shared pool, or undefined when it has none. */
export async function loadServerRewardsOverride(serverId: string): Promise<OverridePool | undefined> {
  const file = serverRewardsPath(serverId);
  const raw = await loadJson(file);
  if (typeof raw === "object" && raw !== null && Object.keys(raw).length === 0) return undefined;
  const shared = isLegacyOverride(raw) ? await loadDailyRewardsConfig() : {};
  const { pool, errors } = overrideFromRaw(raw, shared, file);
  reportProblems(file, errors);
  return pool && Object.keys(pool).length > 0 ? pool : undefined;
}

/** The pool one server draws from. */
export interface ResolvedRewardPool {
  default: DailyRewardItem[];
  streakBonuses?: Record<string, DailyRewardItem[]>;
  bonusChance?: number;
}

/**
 * Resolve the pool a server draws from: the shared pool with the server's
 * exceptions applied. An override that leaves no item at all falls back to the
 * shared items, so a hand-edited file cannot switch /daily off for a server.
 */
export function rewardPoolForServer(cfg: DailyRewardsConfig, override?: OverridePool): ResolvedRewardPool {
  const { pool } = resolvePool(cfg, override);
  const items = pool.default && pool.default.length > 0 ? pool.default : cfg.default;
  return {
    default: items,
    ...(pool.streakBonuses ? { streakBonuses: pool.streakBonuses } : {}),
    ...(pool.bonusChance !== undefined ? { bonusChance: pool.bonusChance } : {}),
  };
}

// ── Editing (the dashboard) ──────────────────────────────────────────────────

export type RewardsScope = { kind: "shared" } | { kind: "server"; serverId: string };

function scopePath(scope: RewardsScope): string {
  return scope.kind === "shared" ? sharedRewardsPath() : serverRewardsPath(scope.serverId);
}

/** Concurrency token of a file that does not exist. */
const ABSENT = "absent";

export interface RewardsDocument<P = RewardPool> {
  /** The document as stored, invalid entries kept out. */
  pool: P;
  /** Problems found in the file as stored; a save must fix them. */
  problems: string[];
  /** Hash of the file's bytes, the token a save is checked against. */
  hash: string;
  exists: boolean;
}

export async function readText(file: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(file, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export function hashOf(text: string | null): string {
  return text === null ? ABSENT : createHash("sha256").update(text).digest("hex");
}

/** Read the shared document straight from disk, with its concurrency token. */
export async function readSharedDocument(): Promise<RewardsDocument> {
  await ensureSharedRewardsFile();
  const text = await readText(sharedRewardsPath());
  if (text === null) return { pool: {}, problems: [], hash: ABSENT, exists: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { pool: {}, problems: [`the file is not valid JSON (${errMsg(err)})`], hash: hashOf(text), exists: true };
  }
  const { pool, errors } = parseRewardPool(raw, "shared");
  return { pool, problems: errors, hash: hashOf(text), exists: true };
}

/** Read one server's exceptions straight from disk, with their concurrency token. */
export async function readServerDocument(serverId: string): Promise<RewardsDocument<OverridePool>> {
  const file = serverRewardsPath(serverId);
  const text = await readText(file);
  if (text === null) return { pool: {}, problems: [], hash: ABSENT, exists: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { pool: {}, problems: [`the file is not valid JSON (${errMsg(err)})`], hash: hashOf(text), exists: true };
  }
  const shared = isLegacyOverride(raw) ? (await readSharedDocument()).pool : {};
  const { pool, errors } = overrideFromRaw(raw, shared, file);
  return { pool: pool ?? {}, problems: errors, hash: hashOf(text), exists: true };
}

/** The shipped defaults, for "start over from the defaults". */
export async function readShippedDefaults(): Promise<RewardPool | null> {
  const text = await readText(defaultsPath());
  if (text === null) return null;
  try {
    return parseRewardPool(JSON.parse(text), "shared").pool;
  } catch {
    return null;
  }
}

export class RewardsWriteError extends Error {
  constructor(
    readonly kind: "conflict" | "invalid",
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "RewardsWriteError";
  }
}

/** Fields in a fixed order, so a save never reshuffles the file. */
const FIELD_ORDER: readonly RewardPoolField[] = ["default", "streakBonuses", "bonusChance"];

const items = (list: readonly DailyRewardItem[], indent: string): string =>
  list.length === 0 ? "[]" : `[\n${list.map((i) => `${indent}  ${JSON.stringify(i)}`).join(",\n")}\n${indent}]`;

/** One reward per line: the file stays readable and diffable by hand. */
export function formatRewardsDocument(pool: RewardPool): string {
  const parts: string[] = [];
  for (const field of FIELD_ORDER) {
    const value = pool[field];
    if (value === undefined) continue;
    if (field === "default") {
      parts.push(`  "default": ${items(value as DailyRewardItem[], "  ")}`);
    } else if (field === "streakBonuses") {
      const days = Object.entries(value as Record<string, DailyRewardItem[]>).sort(
        ([a], [b]) => Number(a) - Number(b),
      );
      const body = days.map(([day, list]) => `    ${JSON.stringify(day)}: ${items(list, "    ")}`).join(",\n");
      parts.push(days.length === 0 ? `  "streakBonuses": {}` : `  "streakBonuses": {\n${body}\n  }`);
    } else {
      parts.push(`  ${JSON.stringify(field)}: ${JSON.stringify(value)}`);
    }
  }
  return parts.length === 0 ? "{}\n" : `{\n${parts.join(",\n")}\n}\n`;
}

function listPatchLines(patch: ListPatch, indent: string): string {
  const inner = `${indent}  `;
  const parts: string[] = [];
  if (patch.add?.length) parts.push(`${inner}"add": ${items(patch.add, inner)}`);
  if (patch.remove?.length) parts.push(`${inner}"remove": ${JSON.stringify(patch.remove)}`);
  if (patch.set && Object.keys(patch.set).length > 0) {
    const sets = Object.entries(patch.set).map(([id, value]) => `${inner}  ${JSON.stringify(id)}: ${JSON.stringify(value)}`);
    parts.push(`${inner}"set": {\n${sets.join(",\n")}\n${inner}}`);
  }
  return `{\n${parts.join(",\n")}\n${indent}}`;
}

/** The override as readable JSON: one entry or set per line. */
export function formatOverrideDocument(override: OverridePool): string {
  const parts: string[] = [];
  if (override.default) parts.push(`  "default": ${listPatchLines(override.default, "  ")}`);
  const streak = override.streakBonuses;
  if (streak) {
    const inner: string[] = [];
    if (streak.removeDays?.length) inner.push(`    "removeDays": ${JSON.stringify(streak.removeDays)}`);
    const days = Object.entries(streak.days ?? {}).sort(([a], [b]) => Number(a) - Number(b));
    if (days.length > 0) {
      const body = days.map(([day, patch]) => `      ${JSON.stringify(day)}: ${listPatchLines(patch, "      ")}`);
      inner.push(`    "days": {\n${body.join(",\n")}\n    }`);
    }
    parts.push(`  "streakBonuses": {\n${inner.join(",\n")}\n  }`);
  }
  if (override.bonusChance !== undefined) parts.push(`  "bonusChance": ${JSON.stringify(override.bonusChance)}`);
  return parts.length === 0 ? "{}\n" : `{\n${parts.join(",\n")}\n}\n`;
}

/**
 * Write one reward document, refusing when the file changed since `baseHash`
 * was read or when the document does not validate. An override with nothing
 * left to say is removed, which is the same as "inherit everything". A shared
 * document is saved with an id on every entry, so a server's exceptions keep
 * pointing at the same entries when the list is reordered.
 *
 * Returns the new hash.
 */
export async function writeRewardsDocument(
  scope: RewardsScope,
  doc: unknown,
  baseHash: string,
): Promise<string> {
  const file = scopePath(scope);
  // The hash check and the write run under one lock per file, so two saves
  // racing in this process cannot both pass the check.
  const prev = writeLocks.get(file) ?? Promise.resolve();
  const run = prev.then(() => writeChecked(scope, file, doc, baseHash));
  writeLocks.set(file, run.catch(() => undefined));
  return run;
}

const writeLocks = new Map<string, Promise<unknown>>();

async function writeChecked(
  scope: RewardsScope,
  file: string,
  doc: unknown,
  baseHash: string,
): Promise<string> {
  const current = hashOf(await readText(file));
  if (current !== baseHash) {
    throw new RewardsWriteError(
      "conflict",
      "The rewards changed since you opened them. Reload and re-apply your changes.",
    );
  }

  if (scope.kind === "shared") {
    const { pool, errors } = parseRewardPool(doc, "shared");
    if (errors.length > 0) throw new RewardsWriteError("invalid", "The reward pool is not valid.", errors);
    const ordered = withEntryIds(pool);
    await saveJson(file, ordered, (d) => formatRewardsDocument(d as RewardPool));
    return hashOf(await readText(file));
  }

  const { pool: parsed, errors } = parseOverridePool(doc);
  if (errors.length > 0) throw new RewardsWriteError("invalid", "The reward pool is not valid.", errors);
  const override = compactOverride(parsed);
  const problems = resolvePool((await readSharedDocument()).pool, override).problems;
  if (problems.length > 0) {
    throw new RewardsWriteError("invalid", "This server would be left without rewards.", problems);
  }
  if (Object.keys(override).length === 0) {
    await removeJson(file);
    return ABSENT;
  }
  await saveJson(file, override, (d) => formatOverrideDocument(d as OverridePool));
  return hashOf(await readText(file));
}
