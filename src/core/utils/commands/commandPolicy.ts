/**
 * Command policy. ONE resolver for every per-command setting, at every
 * scope. Slash commands scope per GUILD (they are issued in guilds),
 * in-game !commands scope per SERVER (they are issued on servers); the
 * global `commands` block is the shared fallback for both.
 *
 *   effective = defaults ← commands[name] ← scope.commands[name]
 *
 * Resolution is FIELD-BY-FIELD: a scope override only changes the
 * fields it actually sets. That makes the mechanism future-proof, a
 * new field added to CommandOverrideConfig inherits the same scoped
 * fallback without touching this file's call sites.
 *
 * Enforcement happens at DISPATCH time (bot/index.ts for slash,
 * defineCommand for in-game), reading loadConfig() live, so `/config
 * reload` and dashboard edits apply immediately. Registration only
 * skips a command when it is disabled in EVERY scope
 * (commandEnabledAnywhere) a command disabled globally but enabled
 * for one guild must stay registered to be dispatchable there.
 *
 * Two rules the resolver deliberately cannot express:
 * - `adminOnly: false` cannot open a built-in admin command; the
 *   requireServerAdmin wrapper in the command itself always runs.
 * - `enabled: true` cannot force a capability-skipped command
 *   (e.g. /backup without the suite) into existence.
 */
import { tryLoadConfig } from "../config/configAccess.js";
import type { BotConfig, CommandOverrideConfig } from "../../types/index.js";

export interface CommandPolicy {
  enabled: boolean;
  adminOnly: boolean;
}

export interface CommandScope {
  /** Guild the interaction came from, slash commands. */
  guildId?: string | undefined;
  /** Server the chat line came from, in-game commands. */
  serverId?: string | undefined;
}

const DEFAULT_POLICY: CommandPolicy = { enabled: true, adminOnly: false };

/** What an unreadable config resolves to: nothing runs, so no restriction is silently dropped. */
const LOCKED_POLICY: CommandPolicy = { enabled: false, adminOnly: true };

/**
 * Without a config file there are no overrides to honour. That is normal in
 * isolated tests, where the defaults apply; anywhere else an unreadable config
 * must not turn into "every command is open".
 */
const failOpen = (): boolean =>
  process.env["VITEST"] !== undefined || process.env["NODE_ENV"] === "test";

function readConfig(): BotConfig | null {
  const loaded = tryLoadConfig({ onError: failOpen() ? "open" : "closed" });
  return loaded.ok ? loaded.config : null;
}

function overlay(
  base: CommandPolicy,
  override: CommandOverrideConfig | undefined,
): CommandPolicy {
  if (!override) return base;
  return {
    enabled: override.enabled ?? base.enabled,
    adminOnly: override.adminOnly ?? base.adminOnly,
  };
}

/** The effective policy for a command in the given scope. */
export function resolveCommandPolicy(
  name: string,
  scope: CommandScope = {},
): CommandPolicy {
  const cfg = readConfig();
  if (!cfg) return failOpen() ? DEFAULT_POLICY : LOCKED_POLICY;

  let policy = overlay(DEFAULT_POLICY, cfg.commands?.[name]);
  if (scope.guildId) {
    policy = overlay(policy, cfg.guilds?.[scope.guildId]?.commands?.[name]);
  }
  if (scope.serverId) {
    policy = overlay(policy, cfg.servers?.[scope.serverId]?.commands?.[name]);
  }
  return policy;
}

/**
 * Is the command effectively enabled in ANY scope? Used at
 * registration/load time: only a command disabled everywhere may be
 * skipped entirely, everything else is gated per dispatch instead.
 */
export function commandEnabledAnywhere(name: string): boolean {
  const cfg = readConfig();
  if (!cfg) return failOpen();

  const globallyEnabled = cfg.commands?.[name]?.enabled ?? true;
  if (globallyEnabled) return true;

  for (const gcfg of Object.values(cfg.guilds ?? {})) {
    if (gcfg.commands?.[name]?.enabled === true) return true;
  }
  for (const srv of Object.values(cfg.servers ?? {})) {
    if (srv.commands?.[name]?.enabled === true) return true;
  }
  return false;
}
