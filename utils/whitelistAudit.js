import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";

const AUDIT_PATH = path.resolve(getRootDir(), "data", "whitelistAudit.json");

/**
 * Load the whitelist audit log.
 * Structure: { "minecraft_username": { addedBy, addedAt, uuid?, removedBy?, removedAt? } }
 */
export async function loadAudit() {
  const data = await loadJson(AUDIT_PATH).catch(() => ({}));
  return data || {};
}

async function saveAudit(audit) {
  await saveJson(AUDIT_PATH, audit);
}

/**
 * Record that a player was whitelisted.
 * @param {string} username - Minecraft username
 * @param {string} discordTag - Discord user tag of who added them
 * @param {string} discordId - Discord user ID of who added them
 * @param {string} serverId - Server the player was whitelisted on
 * @param {string} [uuid] - Mojang UUID if available
 */
export async function recordAdd(
  username,
  discordTag,
  discordId,
  serverId,
  uuid = null,
) {
  const audit = await loadAudit();
  const key = username.toLowerCase();

  audit[key] = {
    username,
    uuid: uuid || audit[key]?.uuid || null,
    addedBy: discordTag,
    addedById: discordId,
    addedAt: new Date().toISOString(),
    server: serverId,
  };

  await saveAudit(audit);
}

/**
 * Record that a player was removed from the whitelist.
 * @param {string} username - Minecraft username
 * @param {string} discordTag - Discord user tag of who removed them
 * @param {string} discordId - Discord user ID of who removed them
 * @param {string} serverId - Server the player was removed from
 */
export async function recordRemove(username, discordTag, discordId, serverId) {
  const audit = await loadAudit();
  const key = username.toLowerCase();

  if (audit[key]) {
    audit[key].removedBy = discordTag;
    audit[key].removedById = discordId;
    audit[key].removedAt = new Date().toISOString();
    audit[key].removedFromServer = serverId;
  } else {
    audit[key] = {
      username,
      removedBy: discordTag,
      removedById: discordId,
      removedAt: new Date().toISOString(),
      removedFromServer: serverId,
    };
  }

  await saveAudit(audit);
}

/**
 * Get the audit entry for a specific player.
 */
export async function getAuditEntry(username) {
  const audit = await loadAudit();
  return audit[username.toLowerCase()] || null;
}
