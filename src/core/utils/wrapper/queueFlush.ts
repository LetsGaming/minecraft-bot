/**
 * Applying queued config edits, in one place.
 *
 * Callers want this from both sides: the dashboard's "Apply now" button, the
 * auto-flush that fires when a wrapper comes back, and (once wired) a bot
 * command doing the same. Having them share an implementation is
 * the whole point — a manual flush and an automatic one that merged by
 * different rules would be a genuinely dangerous divergence, since the thing
 * they differ on is which of an operator's edits get written to a live server.
 */

import { getServerInstance } from "../server/server.js";
import {
  readConfigFile,
  writeConfigFile,
} from "../server/serverAccess.js";
import { applyConfigEdits, parseConfig } from "../configfmt/index.js";
import {
  pendingForServer,
  planMerge,
  dropEdits,
  type EditConflict,
  type QueuedEdit,
} from "../stores/queuedEdits.js";
import { recordAdminAction } from "../stores/adminAudit.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";
import { forget } from "./lastKnown.js";

export interface FlushAuthor {
  tag: string;
  uid: string;
}

export interface FlushResult {
  applied: number;
  conflicts: EditConflict[];
  /** Files the flush touched, whether or not anything was written. */
  files: number;
  /** Files that could not be read, so their edits are still queued. */
  skipped: number;
}

/** Current on-disk values, keyed the same way a queued edit's path is. */
function valuesByKey(relPath: string, text: string): Map<string, unknown> {
  const parsed = parseConfig(relPath, text);
  return new Map(parsed.nodes.map((n) => [JSON.stringify(n.path), n.value] as const));
}

function groupByFile(edits: QueuedEdit[]): Map<string, QueuedEdit[]> {
  const byFile = new Map<string, QueuedEdit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.fileId) ?? [];
    list.push(edit);
    byFile.set(edit.fileId, list);
  }
  return byFile;
}

/**
 * Re-read each file with queued edits, merge per field, write what is clean.
 *
 * Per file rather than per server, so one unreadable file leaves the rest to
 * proceed. Nothing is ever dropped on failure: an edit that could not be
 * applied stays queued and the next flush re-plans it against a fresher read,
 * which is exactly where a genuine conflict surfaces.
 */
export async function flushQueuedEdits(
  serverId: string,
  author: FlushAuthor,
): Promise<FlushResult> {
  const server = getServerInstance(serverId);
  if (!server) return { applied: 0, conflicts: [], files: 0, skipped: 0 };

  const pending = pendingForServer(serverId);
  if (pending.length === 0) return { applied: 0, conflicts: [], files: 0, skipped: 0 };

  const byFile = groupByFile(pending);
  const conflicts: EditConflict[] = [];
  let applied = 0;
  let skipped = 0;

  for (const [fileId, queued] of byFile) {
    let current;
    try {
      current = await readConfigFile(server.config, fileId);
    } catch (err) {
      // Still unreachable, or this one file is gone. Leave the edits queued.
      log.warn("web", `Flush skipped ${fileId} on ${serverId}: ${errMsg(err)}`);
      skipped += 1;
      continue;
    }

    const plan = planMerge(queued, valuesByKey(current.file.relPath, current.text));
    conflicts.push(...plan.conflicts);

    // Edits the disk already satisfies are done, not pending. Dropping them
    // here stops a duplicate change churning the mtime and burning a snapshot.
    dropEdits(plan.alreadyApplied.map((e) => e.id));

    if (plan.apply.length === 0) continue;

    const edits = plan.apply.map((e) => ({ path: e.keyPath, value: e.newValue }));
    let next: string;
    try {
      next = applyConfigEdits(current.file.relPath, current.text, edits);
    } catch (err) {
      // The file's shape changed enough that the splice no longer fits. That
      // is a conflict in everything but name, so leave it for a human.
      log.warn("web", `Flush could not splice ${fileId} on ${serverId}: ${errMsg(err)}`);
      skipped += 1;
      continue;
    }

    const result = await writeConfigFile(server.config, fileId, next, current.etag);
    if (!result.ok) {
      // Someone wrote between our read and our write. Nothing is lost.
      log.warn("web", `Flush lost the race on ${fileId}; edits stay queued.`);
      skipped += 1;
      continue;
    }

    applied += plan.apply.length;
    dropEdits(plan.apply.map((e) => e.id));
    forget(serverId, `configFile:${fileId}`);

    await recordAdminAction({
      action: "mod config edit (queued, applied)",
      server: serverId,
      by: author.tag,
      byId: author.uid,
      detail: `${current.file.relPath}: ${edits.length} queued key(s)`,
    });
  }

  forget(serverId, "configIndex");
  return { applied, conflicts, files: byFile.size, skipped };
}

/**
 * Plan the flush without performing it.
 *
 * The conflict picker needs to know what would happen before anything is
 * written, and it needs the *current* on-disk value to show alongside the
 * queued one. Sharing `planMerge` with the real flush means the preview cannot
 * disagree with the outcome.
 */
export async function previewQueuedEdits(
  serverId: string,
): Promise<{ conflicts: EditConflict[]; ready: number; unreadable: number }> {
  const server = getServerInstance(serverId);
  if (!server) return { conflicts: [], ready: 0, unreadable: 0 };

  const conflicts: EditConflict[] = [];
  let ready = 0;
  let unreadable = 0;

  for (const [fileId, queued] of groupByFile(pendingForServer(serverId))) {
    try {
      const current = await readConfigFile(server.config, fileId);
      const plan = planMerge(queued, valuesByKey(current.file.relPath, current.text));
      conflicts.push(...plan.conflicts);
      ready += plan.apply.length;
    } catch {
      // Cannot say anything about this file yet; the wrapper is still away.
      unreadable += queued.length;
    }
  }
  return { conflicts, ready, unreadable };
}

// ── Auto-flush ──────────────────────────────────────────────────────────────

/**
 * Servers whose wrapper we last saw as unreachable.
 *
 * Auto-flush fires on the *transition* back to reachable, not on every poll
 * where the wrapper happens to be up. Without the edge check, a server that is
 * simply healthy would retry the same conflicted edits on every status poll,
 * writing to a live config file several times a minute for no reason.
 */
const wasUnreachable = new Set<string>();

/** Servers with a flush already running, so overlapping polls do not stack. */
const inFlight = new Set<string>();

/**
 * Told by the status collector what a server's wrapper is doing.
 *
 * Returns whether a flush was started, which is only ever true on the edge
 * from unreachable to reachable with work waiting.
 */
export function noteWrapperState(serverId: string, reachable: boolean): boolean {
  if (!reachable) {
    wasUnreachable.add(serverId);
    return false;
  }
  if (!wasUnreachable.delete(serverId)) return false;
  if (inFlight.has(serverId)) return false;
  if (pendingForServer(serverId).length === 0) return false;

  inFlight.add(serverId);
  log.info("web", `Wrapper for ${serverId} is back — applying queued config edits.`);
  void flushQueuedEdits(serverId, { tag: "auto-flush", uid: "system" })
    .then((res) => {
      if (res.applied > 0 || res.conflicts.length > 0) {
        log.info(
          "web",
          `Auto-flush ${serverId}: ${res.applied} applied, ${res.conflicts.length} conflicted.`,
        );
      }
    })
    .catch((err: unknown) => {
      log.error("web", `Auto-flush for ${serverId} failed: ${errMsg(err)}`);
    })
    .finally(() => inFlight.delete(serverId));
  return true;
}

/** Test seam. */
export function resetAutoFlushState(): void {
  wasUnreachable.clear();
  inFlight.clear();
}
