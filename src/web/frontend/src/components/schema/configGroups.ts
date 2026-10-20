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

/** The groups for the keys the schema has, in table order, empty groups dropped. */
export function configGroups(schemaKeys: readonly string[]): ConfigGroup[] {
  const present = new Set(schemaKeys);
  const placed = new Set<string>();
  const out: ConfigGroup[] = [];
  for (const group of GROUPS) {
    const keys = group.keys.filter((key) => present.has(key));
    keys.forEach((key) => placed.add(key));
    if (keys.length) out.push({ id: group.id, titleKey: group.titleKey, keys });
  }
  const rest = schemaKeys.filter((key) => !placed.has(key));
  if (rest.length) out.push({ id: "other", titleKey: "config.group.other", keys: rest });
  return out;
}
