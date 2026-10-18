/**
 * The daily-reward documents on disk, for the bot's `/daily` and for the
 * dashboard's rewards editor.
 *
 *   data/dailyRewards.defaults.json   shipped with the bot, git-tracked, never written
 *   data/dailyRewards.json            the shared pool, copied from the defaults on first use
 *   data/dailyRewards_<serverId>.json one server's override, field by field
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
  parseRewardPool,
  type RewardPool,
  type RewardPoolField,
} from "@mcbot/schema/dailyRewards.js";
import { isEnoent, loadJson, removeJson, saveJson } from "../jsonStore.js";
import { getRootDir } from "../paths.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";
import type { DailyRewardItem, DailyRewardsConfig } from "../../types/index.js";

function dataDir(): string {
  return path.resolve(getRootDir(), "data");
}

/**
 * Where the editable reward files live. MCBOT_REWARDS_DIR moves them out of
 * data/ (dev-up.mjs points it at the session's own folder, so a dev session
 * never edits the repo's real pool); the shipped defaults stay in data/.
 */
function editableDir(): string {
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

/** A server's override, or undefined when it has none. */
export async function loadServerRewardsOverride(
  serverId: string,
): Promise<RewardPool | undefined> {
  const file = serverRewardsPath(serverId);
  const raw = await loadJson(file);
  if (typeof raw === "object" && raw !== null && Object.keys(raw).length === 0) return undefined;
  const { pool, errors } = parseRewardPool(raw, "override");
  reportProblems(file, errors);
  return Object.keys(pool).length > 0 ? pool : undefined;
}

/** The pool one server draws from. */
export interface ResolvedRewardPool {
  default: DailyRewardItem[];
  streakBonuses?: Record<string, DailyRewardItem[]>;
  bonusChance?: number;
}

/**
 * Resolve the pool a server draws from: each field the server's override
 * sets wins, every other field comes from the shared pool. So a server can
 * override just its items and keep the shared streak bonuses, or the other
 * way round.
 */
export function rewardPoolForServer(
  cfg: DailyRewardsConfig,
  override?: RewardPool,
): ResolvedRewardPool {
  const items = override?.default && override.default.length > 0 ? override.default : cfg.default;
  const streakBonuses = override?.streakBonuses ?? cfg.streakBonuses;
  const bonusChance = override?.bonusChance ?? cfg.bonusChance;
  return {
    default: items,
    ...(streakBonuses ? { streakBonuses } : {}),
    ...(bonusChance !== undefined ? { bonusChance } : {}),
  };
}

// ── Editing (the dashboard) ──────────────────────────────────────────────────

export type RewardsScope = { kind: "shared" } | { kind: "server"; serverId: string };

function scopePath(scope: RewardsScope): string {
  return scope.kind === "shared" ? sharedRewardsPath() : serverRewardsPath(scope.serverId);
}

/** Concurrency token of a file that does not exist. */
const ABSENT = "absent";

export interface RewardsDocument {
  /** The document as stored, invalid entries kept out. */
  pool: RewardPool;
  /** Problems found in the file as stored; a save must fix them. */
  problems: string[];
  /** Hash of the file's bytes, the token a save is checked against. */
  hash: string;
  exists: boolean;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(file, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

function hashOf(text: string | null): string {
  return text === null ? ABSENT : createHash("sha256").update(text).digest("hex");
}

/** Read one reward document straight from disk, with its concurrency token. */
export async function readRewardsDocument(scope: RewardsScope): Promise<RewardsDocument> {
  if (scope.kind === "shared") await ensureSharedRewardsFile();
  const text = await readText(scopePath(scope));
  if (text === null) return { pool: {}, problems: [], hash: ABSENT, exists: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { pool: {}, problems: [`the file is not valid JSON (${errMsg(err)})`], hash: hashOf(text), exists: true };
  }
  const { pool, errors } = parseRewardPool(raw, scope.kind === "shared" ? "shared" : "override");
  return { pool, problems: errors, hash: hashOf(text), exists: true };
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

/** One reward per line: the file stays readable and diffable by hand. */
export function formatRewardsDocument(pool: RewardPool): string {
  const items = (list: DailyRewardItem[], indent: string): string =>
    list.length === 0 ? "[]" : `[\n${list.map((i) => `${indent}  ${JSON.stringify(i)}`).join(",\n")}\n${indent}]`;
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

/**
 * Write one reward document, refusing when the file changed since `baseHash`
 * was read or when the document does not validate. An override with no
 * fields left is removed, which is the same as "inherit everything".
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
  const { pool, errors } = parseRewardPool(doc, scope.kind === "shared" ? "shared" : "override");
  if (errors.length > 0) {
    throw new RewardsWriteError("invalid", "The reward pool is not valid.", errors);
  }

  if (scope.kind === "server" && Object.keys(pool).length === 0) {
    await removeJson(file);
    return ABSENT;
  }

  const ordered: RewardPool = {};
  for (const field of FIELD_ORDER) {
    if (pool[field] !== undefined) (ordered as Record<string, unknown>)[field] = pool[field];
  }
  await saveJson(file, ordered, (d) => formatRewardsDocument(d as RewardPool));
  return hashOf(await readText(file));
}
