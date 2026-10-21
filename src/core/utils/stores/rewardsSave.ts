/**
 * Saving the shared reward pool together with the servers that inherit from
 * it.
 *
 * A shared edit reaches every server that has not opted out, so before it is
 * saved the dashboard asks what it would change per server (`rewardsImpact`)
 * and lets the admin keep or exclude entries for chosen servers. Saving then
 * writes those server files first and the shared file last: a failure part way
 * leaves servers holding a harmless extra local copy, never losing an entry
 * they were meant to keep.
 */
import type {
  ListSelection,
  OverridePool,
  RewardPool,
  RewardsWriteResult,
  ServerImpact,
  ServerSelection,
} from "@mcbot/schema/dailyRewards.js";
import { parseRewardPool } from "@mcbot/schema/dailyRewards.js";
import {
  compactOverride,
  detachEntries,
  excludeEntries,
  serverImpact,
} from "@mcbot/schema/rewardPatch.js";
import {
  readServerDocument,
  readSharedDocument,
  RewardsWriteError,
  withEntryIds,
  writeRewardsDocument,
} from "./rewardsConfig.js";

type ImpactRow = Omit<ServerImpact, "canEdit">;

function parseProposed(raw: unknown): RewardPool {
  const { pool, errors } = parseRewardPool(raw, "shared");
  if (errors.length > 0) throw new RewardsWriteError("invalid", "The reward pool is not valid.", errors);
  return withEntryIds(pool);
}

/**
 * What replacing the stored shared document with `proposed` would do to each
 * server in `serverIds`. Servers it does not touch are left out.
 */
export async function rewardsImpact(proposed: unknown, serverIds: readonly string[]): Promise<ImpactRow[]> {
  const next = parseProposed(proposed);
  const stored = withEntryIds((await readSharedDocument()).pool);
  const rows: ImpactRow[] = [];
  for (const serverId of serverIds) {
    const doc = await readServerDocument(serverId);
    const { changes, orphans } = serverImpact(stored, next, doc.pool);
    if (changes.length > 0 || orphans.length > 0) {
      rows.push({ serverId, hasOverride: doc.exists, changes, orphans });
    }
  }
  return rows;
}

function selected(list: ListSelection | undefined): Array<{ where: string; ids: string[] }> {
  const out: Array<{ where: string; ids: string[] }> = [];
  if (list?.pool?.length) out.push({ where: "default", ids: list.pool });
  for (const [day, ids] of Object.entries(list?.days ?? {})) {
    if (ids.length > 0) out.push({ where: day, ids });
  }
  return out;
}

/** The server's exceptions after applying a keep/exclude selection. */
export function applySelection(
  storedShared: RewardPool,
  current: OverridePool,
  selection: ServerSelection,
): OverridePool {
  const next: OverridePool = JSON.parse(JSON.stringify(current)) as OverridePool;
  const dayPatch = (day: string) => next.streakBonuses?.days?.[day];
  const setDay = (day: string, patch: ReturnType<typeof dayPatch>): void => {
    const streak = (next.streakBonuses ??= {});
    const days = (streak.days ??= {});
    if (patch) days[day] = patch;
    else delete days[day];
  };

  for (const { where, ids } of selected(selection.keep)) {
    if (where === "default") {
      next.default = detachEntries(storedShared.default, next.default, ids, true);
      if (!next.default) delete next.default;
    } else {
      setDay(where, detachEntries(storedShared.streakBonuses?.[where], dayPatch(where), ids, false));
    }
  }
  for (const { where, ids } of selected(selection.exclude)) {
    if (where === "default") {
      next.default = excludeEntries(next.default, ids);
      if (!next.default) delete next.default;
    } else {
      setDay(where, excludeEntries(dayPatch(where), ids));
    }
  }
  return compactOverride(next);
}

export interface SharedSaveHooks {
  /** Called after each file is written; `serverId` is null for the shared file. */
  onWritten?: (serverId: string | null, pool: unknown) => Promise<void>;
}

/**
 * Save the shared document, first writing the keep/exclude choices into the
 * named servers' files. Nothing is written when the shared file has changed
 * since `baseHash`, or when a server's file cannot take its change.
 */
export async function saveSharedWithServers(
  baseHash: string,
  proposed: unknown,
  servers: Record<string, ServerSelection>,
  hooks: SharedSaveHooks = {},
): Promise<RewardsWriteResult> {
  const next = parseProposed(proposed);
  const stored = await readSharedDocument();
  if (stored.hash !== baseHash) {
    throw new RewardsWriteError("conflict", "The rewards changed since you opened them. Reload and re-apply your changes.");
  }
  const storedWithIds = withEntryIds(stored.pool);

  const written: Record<string, { hash: string }> = {};
  for (const [serverId, selection] of Object.entries(servers)) {
    const doc = await readServerDocument(serverId);
    const patch = applySelection(storedWithIds, doc.pool, selection);
    if (JSON.stringify(patch) === JSON.stringify(compactOverride(doc.pool))) continue;
    try {
      const hash = await writeRewardsDocument({ kind: "server", serverId }, patch, doc.hash);
      written[serverId] = { hash };
    } catch (err) {
      if (err instanceof RewardsWriteError) {
        throw new RewardsWriteError(err.kind, err.message, err.errors, serverId);
      }
      throw err;
    }
    await hooks.onWritten?.(serverId, patch);
  }

  const hash = await writeRewardsDocument({ kind: "shared" }, next, baseHash);
  await hooks.onWritten?.(null, next);
  return Object.keys(written).length > 0 ? { hash, servers: written } : { hash };
}
