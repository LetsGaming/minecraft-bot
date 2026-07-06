/**
 * Command policy — ONE resolver for every per-command setting, at every
 * scope. Slash commands scope per GUILD (they are issued in guilds),
 * in-game !commands scope per SERVER (they are issued on servers); the
 * global `commands` block is the shared fallback for both.
 *
 *   effective = defaults ← commands[name] ← scope.commands[name]
 *
 * Resolution is FIELD-BY-FIELD: a scope override only changes the
 * fields it actually sets. That makes the mechanism future-proof — a
 * new field added to CommandOverrideConfig inherits the same scoped
 * fallback without touching this file's call sites.
 *
 * Enforcement happens at DISPATCH time (bot/index.ts for slash,
 * defineCommand for in-game), reading loadConfig() live, so `/config
 * reload` and dashboard edits apply immediately. Registration only
 * skips a command when it is disabled in EVERY scope
 * (commandEnabledAnywhere) — a command disabled globally but enabled
 * for one guild must stay registered to be dispatchable there.
 *
 * Two rules the resolver deliberately cannot express:
 * - `adminOnly: false` cannot open a built-in admin command; the
 *   requireServerAdmin wrapper in the command itself always runs.
 * - `enabled: true` cannot force a capability-skipped command
 *   (e.g. /backup without the suite) into existence.
 */
import { loadConfig } from "../config.js";
import type { CommandOverrideConfig } from "../types/index.js";

export interface CommandPolicy {
  enabled: boolean;
  adminOnly: boolean;
}

export interface CommandScope {
  /** Guild the interaction came from — slash commands. */
  guildId?: string | undefined;
  /** Server the chat line came from — in-game commands. */
  serverId?: string | undefined;
}

const DEFAULT_POLICY: CommandPolicy = { enabled: true, adminOnly: false };

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
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    return DEFAULT_POLICY; // isolated tests / schema generator
  }

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
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    return true;
  }

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
