/**
 * Guild-config source for long-lived watchers, monitors and schedulers.
 *
 * Everything under logWatcher/ is wired exactly once — at startup, or when
 * reconciliation adds a server — and then runs for the lifetime of the
 * process. Handing those functions a plain `Record<string, GuildConfig>`
 * froze a SNAPSHOT of `config.guilds` taken at wiring time, and
 * `reconcileServers` only reconciles the `servers` block. So a guild added
 * (or a chatBridge/notifications block edited) after startup never reached
 * the handlers and the feature stayed dead until a full process restart —
 * which in a two-guild deployment reads as "it only works for one of my
 * guilds".
 *
 * The fix is the same shape `startDowntimeMonitor` already uses for server
 * instances: accept either a fixed record (tests, callers that really do
 * want a fixed set) or a PROVIDER consulted at event time. Production
 * wiring passes `liveGuildConfigs`.
 */
import { loadConfig } from "@mcbot/core/config.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";

export type GuildConfigs = Record<string, GuildConfig>;

/** A fixed guild-config record, or a provider consulted per event/tick. */
export type GuildConfigSource = GuildConfigs | (() => GuildConfigs);

/** The guild block as config.json currently defines it. */
export function liveGuildConfigs(): GuildConfigs {
  return loadConfig().guilds;
}

/** Resolve a source to the guild configs to use for THIS event. */
export function resolveGuildConfigs(source: GuildConfigSource): GuildConfigs {
  return typeof source === "function" ? source() : source;
}

/** Live guild entries a feature is configured for. Resolve per tick. */
export function guildsWith(
  source: GuildConfigSource,
  predicate: (cfg: GuildConfig) => boolean,
): Array<[string, GuildConfig]> {
  return Object.entries(resolveGuildConfigs(source)).filter(([, cfg]) =>
    predicate(cfg),
  );
}
