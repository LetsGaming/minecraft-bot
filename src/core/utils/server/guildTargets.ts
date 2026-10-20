/**
 * Which servers a Discord guild may target, and which one it targets by
 * default. Pure config logic with no dependency on the live instance
 * registry, so both the bot and `getGuildServer` can share it.
 */
import { loadConfig } from "../../config.js";

import { t } from "@mcbot/core/utils/i18n.js";
import { allowedServerIdsIn, referencedServerIds } from "./guildScopes.js";

// Pure rules live in guildScopes so config validation can use them without loading the config.
export { allowedServerIdsIn, referencedServerIds };

/**
 * Which server IDs may commands from this guild target?
 *
 * `null` means unrestricted: single-tenant setups, or a guild that
 * references no servers and sets no allowedServers (a startup warning
 * nudges the operator). An empty set means deny: DMs and unconfigured
 * guilds in multi-guild deployments; resolveServer layers the
 * global-admin exception on top.
 */
export function getAllowedServerIds(
  guildId: string | undefined,
): Set<string> | null {
  return allowedServerIdsIn(loadConfig().guilds, guildId);
}

/** The subset of `serverIds` this guild may target, in the given order. */
export function visibleServerIdsForGuild(
  guildId: string | undefined,
  serverIds: readonly string[],
): string[] {
  const allowed = getAllowedServerIds(guildId);
  return serverIds.filter((id) => !allowed || allowed.has(id));
}

/**
 * The server a command targets when it names none.
 *
 * Order: the guild's `defaultServer`; otherwise the only server the guild
 * may target (a DM counts every configured server). A `defaultServer`
 * that names no running server is a configuration error, never silently
 * replaced. Throws with the available IDs when the choice is ambiguous.
 *
 * Callers still apply the tenant check to the returned ID.
 */
export function resolveDefaultServerId(
  guildId: string | undefined,
  runningServerIds: readonly string[],
): string {
  const configured = guildId
    ? loadConfig().guilds?.[guildId]?.defaultServer
    : undefined;
  if (configured) {
    if (runningServerIds.includes(configured)) return configured;
    throw new Error(
      t("target.defaultNotRunning", {
        server: configured,
        available: runningServerIds.join(", ") || t("target.none"),
      }),
    );
  }

  const candidates = guildId
    ? visibleServerIdsForGuild(guildId, runningServerIds)
    : [...runningServerIds];
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new Error(t("target.noneAvailable"));
  }
  throw new Error(
    t("target.several", { servers: candidates.join(", ") }),
  );
}
