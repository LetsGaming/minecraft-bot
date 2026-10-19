/**
 * Stat-milestone bookkeeping: single owner of kv_store["milestones"].
 * Remembers the highest threshold already announced per player, and which
 * stats have had their silent baseline pass.
 */
import { documentStore } from "./versionedStore.js";

export interface MilestoneState {
  /** serverId → statKey → uuid → highest announced (or seeded) value */
  servers: Record<string, Record<string, Record<string, number>>>;
  /** serverId → statKey → seeded flag */
  seeded: Record<string, Record<string, boolean>>;
}

const milestoneDoc = documentStore<MilestoneState>("milestones", (raw) => {
  const doc = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<MilestoneState>;
  return { servers: doc.servers ?? {}, seeded: doc.seeded ?? {} };
});

export function loadMilestoneState(): MilestoneState {
  return milestoneDoc.load();
}

/** Change the state in one transaction; see versionedStore. */
export function updateMilestoneState<T>(fn: (state: MilestoneState) => T): T {
  return milestoneDoc.update(fn);
}
