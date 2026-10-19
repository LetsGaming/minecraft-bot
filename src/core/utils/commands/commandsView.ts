/**
 * The payload behind the dashboard's Commands view: the manifest, the raw
 * override blocks at each scope, the effective policy per command per scope
 * (so the UI can show what "inherit" resolves to), and recent usage.
 *
 * Kept out of the route so it can be tested without a web server. The policy
 * and usage lookups are injectable for the same reason.
 */
import { COMMAND_OPTIONS } from "@mcbot/schema";
import type { CommandOverrideConfig, RawBotConfig } from "../../types/index.js";
import type { CommandManifest } from "./commandManifest.js";
import { resolveCommandPolicy, type CommandPolicy, type CommandScope } from "./commandPolicy.js";
import {
  usageByCommand,
  USAGE_WINDOW_DAYS,
  type CommandUsageCount,
} from "./commandUsage.js";

export interface CommandUsageSummary {
  count: number;
  users: number;
  lastUsedAt: number | null;
}

export interface CommandsView {
  hash: string;
  manifest: CommandManifest;
  usage: { windowDays: number; byCommand: Record<string, CommandUsageSummary> };
  scopes: { guildIds: string[]; serverIds: string[] };
  commandOptions: typeof COMMAND_OPTIONS;
  overrides: {
    global: Record<string, CommandOverrideConfig>;
    guilds: Record<string, Record<string, CommandOverrideConfig>>;
    servers: Record<string, Record<string, CommandOverrideConfig>>;
  };
  effective: Record<string, Record<string, CommandPolicy>>;
}

export interface CommandsViewDeps {
  resolvePolicy: (name: string, scope?: CommandScope) => CommandPolicy;
  usage: () => CommandUsageCount[];
}

const DEFAULT_DEPS: CommandsViewDeps = {
  resolvePolicy: (name, scope) => resolveCommandPolicy(name, scope),
  usage: () => usageByCommand(USAGE_WINDOW_DAYS),
};

/**
 * One command may be used on both surfaces (slash and in-game), so the rows
 * are folded by name: summed uses, the larger distinct-user count, the latest
 * use.
 */
export function summariseUsage(
  rows: readonly CommandUsageCount[],
): Record<string, CommandUsageSummary> {
  const byName: Record<string, CommandUsageSummary> = {};
  for (const row of rows) {
    const existing = byName[row.command];
    byName[row.command] = {
      count: (existing?.count ?? 0) + row.count,
      users: Math.max(existing?.users ?? 0, row.users),
      lastUsedAt: Math.max(existing?.lastUsedAt ?? 0, row.lastUsedAt ?? 0) || null,
    };
  }
  return byName;
}

export function buildCommandsView(
  input: { manifest: CommandManifest; raw: RawBotConfig; hash: string },
  deps: CommandsViewDeps = DEFAULT_DEPS,
): CommandsView {
  const { manifest, raw, hash } = input;
  const guildIds = Object.keys(raw.guilds ?? {});
  const serverIds = Object.keys(raw.servers ?? {});

  const effective = (name: string): Record<string, CommandPolicy> => {
    const out: Record<string, CommandPolicy> = { global: deps.resolvePolicy(name) };
    for (const guildId of guildIds) {
      out[`guild:${guildId}`] = deps.resolvePolicy(name, { guildId });
    }
    for (const serverId of serverIds) {
      out[`server:${serverId}`] = deps.resolvePolicy(name, { serverId });
    }
    return out;
  };

  return {
    hash,
    manifest,
    // Usage rides along on the command list rather than getting a page of
    // its own: an unused command is either badly advertised or worth
    // deleting, and the operator needs the other columns to tell which.
    usage: { windowDays: USAGE_WINDOW_DAYS, byCommand: summariseUsage(deps.usage()) },
    scopes: { guildIds, serverIds },
    commandOptions: COMMAND_OPTIONS,
    overrides: {
      global: raw.commands ?? {},
      guilds: Object.fromEntries(
        guildIds.map((id) => [id, raw.guilds?.[id]?.commands ?? {}]),
      ),
      servers: Object.fromEntries(
        serverIds.map((id) => [id, raw.servers?.[id]?.commands ?? {}]),
      ),
    },
    effective: Object.fromEntries(
      [...manifest.slash, ...manifest.ingame].map((c) => [c.name, effective(c.name)]),
    ),
  };
}
