/**
 * Config edits made while the API wrapper was unreachable, held until it
 * answers again.
 *
 * The read half of this (see the web backend's `lastKnown`) lets someone open
 * the mod config editor during a wrapper outage and see the last values we
 * read. Without this half, they can look and not touch: the save fails and
 * their work lives only in the browser tab until they close it.
 *
 * ── The unit is a key, not a file ──
 *
 * Every row is one (server, file, key path) edit. That is what makes the
 * agreed conflict policy cheap: on flush, an edit applies unless *that key*
 * changed on disk while it waited. Queuing whole files instead would force an
 * all-or-nothing conflict and discard edits that never contended with
 * anything — someone tuning a spawn rate would lose it because an unrelated
 * key three sections down was touched by a mod update.
 *
 * `baseValue` is the on-disk value at queue time, and it is the entire basis
 * of conflict detection. Comparing the queued value against the current one
 * would be wrong: an edit that happens to match what someone else already
 * wrote is not a conflict, and an edit back to a value's original is not a
 * no-op. What matters is whether the ground moved underneath it.
 *
 * ── Durable on purpose ──
 *
 * In SQLite rather than memory, because the window this exists for is exactly
 * the one in which things get restarted. An edit lost to a bot restart during
 * a wrapper outage is precisely the failure the feature was built to prevent.
 */

import { getDb, withTransaction } from "../../db/index.js";
import { mapRows, col } from "../../db/rows.js";

/** A queued change to a single key. */
export interface QueuedEdit {
  id: number;
  serverId: string;
  fileId: string;
  relPath: string;
  /** Path from the document root, e.g. ["general", "spawnRate"]. */
  keyPath: string[];
  /** What the operator wants the value to be. */
  newValue: unknown;
  /** What was on disk when they queued it. */
  baseValue: unknown;
  queuedAt: number;
  byId: string | null;
  byTag: string | null;
}

export interface QueueAuthor {
  id: string;
  tag: string;
}

/**
 * A queued edit whose key changed on disk while it waited.
 *
 * Deliberately carries all three values. "Someone else changed this" is not
 * actionable; "you set 3, it was 2 when you queued it, it is 5 now" lets a
 * person decide in one read.
 */
export interface EditConflict {
  /** Which file this key lives in — the picker needs it to resolve. */
  fileId: string;
  keyPath: string[];
  /** The value the operator queued. */
  queued: unknown;
  /** What was on disk when they queued it. */
  base: unknown;
  /** What is on disk now. */
  current: unknown;
  queuedAt: number;
  byTag: string | null;
}

const serialise = (value: unknown): string => JSON.stringify(value ?? null);
const deserialise = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A row we cannot read is worse than no row: applying a half-understood
    // value to a live config is the one outcome to avoid. Null reads as "no
    // recorded value" everywhere below and will surface as a conflict.
    return null;
  }
};

/**
 * Queue edits, superseding any already held for the same keys.
 *
 * Editing the same key twice before a flush is a correction, not two changes,
 * so the second replaces the first. The original `baseValue` is deliberately
 * NOT preserved across a supersede: the disk has not been touched in between,
 * so the base is still the base, and re-reading it is what the caller passes.
 */
export function queueEdits(
  serverId: string,
  fileId: string,
  relPath: string,
  edits: readonly { keyPath: string[]; newValue: unknown; baseValue: unknown }[],
  author: QueueAuthor | null,
  now: number = Date.now(),
): number {
  if (edits.length === 0) return 0;
  return withTransaction(() => {
    const stmt = getDb().prepare(`
      INSERT INTO queued_config_edits
        (server_id, file_id, rel_path, key_path, new_value, base_value, queued_at, by_id, by_tag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (server_id, file_id, key_path) DO UPDATE SET
        new_value = excluded.new_value,
        base_value = excluded.base_value,
        queued_at = excluded.queued_at,
        by_id = excluded.by_id,
        by_tag = excluded.by_tag
    `);
    for (const edit of edits) {
      stmt.run(
        serverId,
        fileId,
        relPath,
        JSON.stringify(edit.keyPath),
        serialise(edit.newValue),
        serialise(edit.baseValue),
        now,
        author?.id ?? null,
        author?.tag ?? null,
      );
    }
    return edits.length;
  });
}

function rowToEdit(row: Record<string, unknown>): QueuedEdit {
  return {
    id: col.int(row, "id"),
    serverId: col.text(row, "server_id"),
    fileId: col.text(row, "file_id"),
    relPath: col.text(row, "rel_path"),
    keyPath: deserialise(col.text(row, "key_path")) as string[],
    newValue: deserialise(col.text(row, "new_value")),
    baseValue: deserialise(col.text(row, "base_value")),
    queuedAt: col.int(row, "queued_at"),
    byId: col.textOrNull(row, "by_id"),
    byTag: col.textOrNull(row, "by_tag"),
  };
}

/** Everything still waiting for a server, oldest first. */
export function pendingForServer(serverId: string): QueuedEdit[] {
  return mapRows(
    getDb().prepare(
      `SELECT id, server_id, file_id, rel_path, key_path, new_value,
              base_value, queued_at, by_id, by_tag
       FROM queued_config_edits
       WHERE server_id = ? ORDER BY queued_at ASC, id ASC`,
    ),
    rowToEdit,
    serverId,
  );
}

/** Everything still waiting for one file. */
export function pendingForFile(serverId: string, fileId: string): QueuedEdit[] {
  return mapRows(
    getDb().prepare(
      `SELECT id, server_id, file_id, rel_path, key_path, new_value,
              base_value, queued_at, by_id, by_tag
       FROM queued_config_edits
       WHERE server_id = ? AND file_id = ? ORDER BY queued_at ASC, id ASC`,
    ),
    rowToEdit,
    serverId,
    fileId,
  );
}

/** Drop specific queued edits, by row id. */
export function dropEdits(ids: readonly number[]): void {
  if (ids.length === 0) return;
  withTransaction(() => {
    const stmt = getDb().prepare("DELETE FROM queued_config_edits WHERE id = ?");
    for (const id of ids) stmt.run(id);
  });
}

/**
 * Move a queued edit's base to the value now on disk.
 *
 * This is how "keep mine" resolves a conflict. The edit itself is unchanged —
 * the operator still wants the value they chose — but the baseline it was
 * measured against is now the current one, so the next flush sees an untouched
 * key and applies it. Rewriting `newValue` instead would silently discard the
 * change; dropping and re-queueing would lose who queued it and when.
 */
export function rebaseEdit(
  serverId: string,
  fileId: string,
  keyPath: string[],
  currentValue: unknown,
): void {
  getDb()
    .prepare(
      `UPDATE queued_config_edits SET base_value = ?
       WHERE server_id = ? AND file_id = ? AND key_path = ?`,
    )
    .run(serialise(currentValue), serverId, fileId, JSON.stringify(keyPath));
}

/** Drop a single queued edit by key. This is how "keep theirs" resolves. */
export function dropEditByKey(
  serverId: string,
  fileId: string,
  keyPath: string[],
): void {
  getDb()
    .prepare(
      `DELETE FROM queued_config_edits
       WHERE server_id = ? AND file_id = ? AND key_path = ?`,
    )
    .run(serverId, fileId, JSON.stringify(keyPath));
}

/** Drop everything queued for a file. Used when an operator abandons them. */
export function dropForFile(serverId: string, fileId: string): void {
  getDb()
    .prepare("DELETE FROM queued_config_edits WHERE server_id = ? AND file_id = ?")
    .run(serverId, fileId);
}

export interface MergePlan {
  /** Edits whose key is untouched since queueing — safe to write. */
  apply: QueuedEdit[];
  /** Edits whose key moved underneath them — need a person. */
  conflicts: EditConflict[];
  /**
   * Edits the disk already satisfies. Not conflicts and not writes: someone
   * else made the same change, so applying it again would be a no-op that
   * still churns the file's mtime and its snapshot history.
   */
  alreadyApplied: QueuedEdit[];
}

/**
 * Decide what to do with a file's queued edits against its current contents.
 *
 * Pure: it takes the current values and returns a plan, so the policy can be
 * tested exhaustively without a wrapper, a database or a filesystem. The
 * caller does the writing.
 *
 * `currentValues` maps a serialised key path to the value on disk now. A key
 * absent from it is treated as removed, which is a conflict rather than a
 * silent re-add: the mod update that dropped the key presumably had a reason,
 * and resurrecting it without asking is not this function's call to make.
 */
export function planMerge(
  queued: readonly QueuedEdit[],
  currentValues: ReadonlyMap<string, unknown>,
): MergePlan {
  const plan: MergePlan = { apply: [], conflicts: [], alreadyApplied: [] };
  for (const edit of queued) {
    const key = JSON.stringify(edit.keyPath);
    const present = currentValues.has(key);
    const current = currentValues.get(key) ?? null;

    if (!present) {
      plan.conflicts.push(toConflict(edit, null));
      continue;
    }
    // Same value already on disk: nothing to write, nothing to ask about.
    if (sameValue(current, edit.newValue)) {
      plan.alreadyApplied.push(edit);
      continue;
    }
    // The ground did not move: apply.
    if (sameValue(current, edit.baseValue)) {
      plan.apply.push(edit);
      continue;
    }
    plan.conflicts.push(toConflict(edit, current));
  }
  return plan;
}

function toConflict(edit: QueuedEdit, current: unknown): EditConflict {
  return {
    fileId: edit.fileId,
    keyPath: edit.keyPath,
    queued: edit.newValue,
    base: edit.baseValue,
    current,
    queuedAt: edit.queuedAt,
    byTag: edit.byTag,
  };
}

/**
 * Value equality for config scalars and lists.
 *
 * Structural rather than referential, and order-sensitive for arrays because
 * a config list's order is frequently meaningful (replacement blocks, load
 * order). JSON comparison is enough: these values came out of a config parser
 * and are scalars, arrays of scalars, or null.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
