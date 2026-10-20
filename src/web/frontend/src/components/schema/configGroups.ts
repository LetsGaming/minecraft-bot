import type { MessageKey } from "../../i18n";

export interface ConfigGroup {
  id: string;
  titleKey: MessageKey;
  keys: string[];
}

/**
 * How the Config editor groups the top-level keys of config.json. A key the
 * table does not name (a field added to the schema later) lands in "Other",
 * so nothing the schema defines is ever hidden.
 */
const GROUPS: ReadonlyArray<{ id: string; titleKey: MessageKey; keys: readonly string[] }> = [
  { id: "bot", titleKey: "config.group.bot", keys: ["token", "clientId", "adminUsers", "language", "timezone", "presence", "configVersion"] },
  { id: "servers", titleKey: "config.group.servers", keys: ["servers", "schedules"] },
  { id: "alerts", titleKey: "config.group.alerts", keys: ["tpsWarningThreshold", "tpsPollIntervalMs", "hostAlerts", "updateNotifier"] },
  { id: "leaderboard", titleKey: "config.group.leaderboard", keys: ["leaderboardInterval", "leaderboardPostTime", "leaderboardPostDay", "milestones"] },
  { id: "features", titleKey: "config.group.features", keys: ["commands", "deathCoords", "waypoints", "featureNudges", "limits"] },
  { id: "web", titleKey: "config.group.web", keys: ["webui"] },
];

type GroupTable = ReadonlyArray<{ id: string; titleKey: MessageKey; keys: readonly string[] }>;

function buildGroups(table: GroupTable, schemaKeys: readonly string[], otherKey: MessageKey): ConfigGroup[] {
  const present = new Set(schemaKeys);
  const placed = new Set<string>();
  const out: ConfigGroup[] = [];
  for (const group of table) {
    const keys = group.keys.filter((key) => present.has(key));
    keys.forEach((key) => placed.add(key));
    if (keys.length) out.push({ id: group.id, titleKey: group.titleKey, keys });
  }
  const rest = schemaKeys.filter((key) => !placed.has(key));
  if (rest.length) out.push({ id: "other", titleKey: otherKey, keys: rest });
  return out;
}

/** The groups for the keys the schema has, in table order, empty groups dropped. */
export function configGroups(schemaKeys: readonly string[]): ConfigGroup[] {
  return buildGroups(GROUPS, schemaKeys, "config.group.other");
}

/** The tabs of the per-guild editor; same rule, so a new GuildConfig key lands in "Other". */
const GUILD_GROUPS: GroupTable = [
  { id: "general", titleKey: "guildEditor.group.general", keys: ["defaultServer", "language", "timezone", "adminUsers", "allowedServers", "linkedRole"] },
  { id: "chat", titleKey: "guildEditor.group.chat", keys: ["chatBridge", "bridgeLabel", "bridgeBlocklist", "notifications"] },
  { id: "leaderboard", titleKey: "guildEditor.group.leaderboard", keys: ["leaderboard"] },
  { id: "alerts", titleKey: "guildEditor.group.alerts", keys: ["statusEmbed", "downtimeAlerts", "tpsAlerts", "channelPurge"] },
  { id: "support", titleKey: "guildEditor.group.support", keys: ["reports", "console", "whitelistApplications"] },
  { id: "commands", titleKey: "guildEditor.group.commands", keys: ["commands"] },
];

export function guildConfigGroups(schemaKeys: readonly string[]): ConfigGroup[] {
  return buildGroups(GUILD_GROUPS, schemaKeys, "config.group.other");
}
