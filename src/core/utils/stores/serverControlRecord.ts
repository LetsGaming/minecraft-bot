/**
 * The last confirmed `/server stop` or `/server restart` per server, so
 * `/status` can say who took an offline server down and when, also after a
 * bot restart.
 */
import { kvGet, kvUpdate } from "../../db/kv.js";
import { lastOnlineStreakStart } from "./uptimeTracker.js";

export type ControlKind = "stop" | "restart";

export interface ControlRecord {
  kind: ControlKind;
  /** Discord username of the admin who confirmed. */
  by: string;
  byId: string;
  /** Unix ms. */
  at: number;
}

type ControlRecordStore = Record<string, ControlRecord>;

const KEY = "serverControl";

export function recordControlAction(serverId: string, record: ControlRecord): void {
  kvUpdate<ControlRecordStore>(KEY, (current) => ({ ...(current ?? {}), [serverId]: record }));
}

export function lastControlAction(serverId: string): ControlRecord | null {
  return kvGet<ControlRecordStore>(KEY)?.[serverId] ?? null;
}

/**
 * The record that explains the current downtime, or null. A record older
 * than the latest online period belongs to an earlier stop: the server came
 * back since, so it says nothing about why it is down now.
 */
export function controlActionBehindDowntime(serverId: string): ControlRecord | null {
  const record = lastControlAction(serverId);
  if (!record) return null;
  const onlineSince = lastOnlineStreakStart(serverId);
  return onlineSince === null || record.at >= onlineSince ? record : null;
}
