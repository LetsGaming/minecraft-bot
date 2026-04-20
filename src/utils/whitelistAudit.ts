import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";
import { formatDatetime } from "./time.js";
import type { WhitelistAuditEntry, WhitelistAuditMap } from "../types/index.js";

const AUDIT_PATH = path.resolve(getRootDir(), "data", "whitelistAudit.json");

/**
 * Load the whitelist audit log.
 */
export async function loadAudit(): Promise<WhitelistAuditMap> {
  const data = await loadJson(AUDIT_PATH).catch(() => ({}));
  return (data as WhitelistAuditMap) || {};
}

async function saveAudit(audit: WhitelistAuditMap): Promise<void> {
  await saveJson(AUDIT_PATH, audit);
}

/**
 * Record that a player was whitelisted.
 */
export async function recordAdd(
  username: string,
  discordTag: string,
  discordId: string,
  serverId: string,
  uuid: string | null = null,
): Promise<void> {
  const audit = await loadAudit();
  const key = username.toLowerCase();

  audit[key] = {
    username,
    uuid: uuid ?? audit[key]?.uuid ?? null,
    addedBy: discordTag,
    addedById: discordId,
    addedAt: formatDatetime(),
    server: serverId,
  };

  await saveAudit(audit);
}

/**
 * Record that a player was removed from the whitelist.
 */
export async function recordRemove(
  username: string,
  discordTag: string,
  discordId: string,
  serverId: string,
): Promise<void> {
  const audit = await loadAudit();
  const key = username.toLowerCase();

  if (audit[key]) {
    audit[key]!.removedBy = discordTag;
    audit[key]!.removedById = discordId;
    audit[key]!.removedAt = formatDatetime();
    audit[key]!.removedFromServer = serverId;
  } else {
    audit[key] = {
      username,
      removedBy: discordTag,
      removedById: discordId,
      removedAt: formatDatetime(),
      removedFromServer: serverId,
    };
  }

  await saveAudit(audit);
}

/**
 * Get the audit entry for a specific player.
 */
export async function getAuditEntry(
  username: string,
): Promise<WhitelistAuditEntry | null> {
  const audit = await loadAudit();
  return audit[username.toLowerCase()] ?? null;
}
