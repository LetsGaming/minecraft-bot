import { registerLogCommand } from "./logWatcher.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commands/commandPolicy.js";
import { loadLinkedAccounts } from "@mcbot/core/utils/stores/linkUtils.js";
import { isServerAdmin } from "../commands/middleware.js";
import { t } from "@mcbot/core/utils/i18n.js";
import type { Client } from "discord.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import type {
  InGameCommandDefinition,
  InGameCommandResult,
  InGameCommandInfo,
} from "@mcbot/core/types/index.js";
import { log } from "@mcbot/core/utils/logger.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";

const cooldowns = new Map<string, number>();

// BUG-01: the map keys on `command:player` and used to grow without
// bound (a slow leak on busy servers with churny player bases). An
// entry stops mattering once it is older than the LARGEST cooldown any
// command declared, so a periodic sweep with that horizon keeps the map
// proportional to *recent* activity. The timer is unref()'d — it must
// never keep the process (or the test runner) alive.
let maxCooldownMs = 0;
const COOLDOWN_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** Remove entries no cooldown check can ever consult again. */
export function sweepCooldowns(now = Date.now()): number {
  let removed = 0;
  for (const [key, lastUsed] of cooldowns) {
    if (now - lastUsed > maxCooldownMs) {
      cooldowns.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Current number of tracked cooldown entries (test observability). */
export function cooldownStoreSize(): number {
  return cooldowns.size;
}

setInterval(() => sweepCooldowns(), COOLDOWN_SWEEP_INTERVAL_MS).unref();

/**
 * Declarative in-game command definition with optional cooldowns.
 */
export function defineCommand({
  name,
  aliases = [],
  description,
  args = [],
  cooldown = 0,
  handler,
}: InGameCommandDefinition): InGameCommandResult {
  // BUG-01: the sweep horizon must cover the longest cooldown in play.
  if (cooldown * 1000 > maxCooldownMs) maxCooldownMs = cooldown * 1000;

  const allNames = [name, ...aliases].map((n) => n.replace(/^!/, ""));
  const escapedNames = allNames.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const namePattern = escapedNames.join("|");

  // Args are single tokens, except that the LAST arg may be declared
  // greedy by suffixing its name with "..." (e.g. args: ["message..."]) or
  // optional by suffixing it with "?" (e.g. args: ["category?"]). A greedy
  // arg captures the rest of the chat line, which is what free-text
  // commands like `!report <message...>` need; an optional arg may simply
  // be omitted. Either anywhere but last would make parsing ambiguous, so
  // that's a definition error.
  args.forEach((arg, i) => {
    if (
      (arg.endsWith("...") || arg.endsWith("?")) &&
      i !== args.length - 1
    ) {
      throw new Error(
        `defineCommand(!${name}): arg "${arg}" (greedy/optional) must be the last argument`,
      );
    }
  });
  const argsPattern = args
    .map((arg, i) => {
      if (i !== args.length - 1) return "\\s+(\\S+)";
      if (arg.endsWith("...")) return "\\s+(.+?)\\s*$";
      if (arg.endsWith("?")) return "(?:\\s+(\\S+))?";
      return "\\s+(\\S+)";
    })
    .join("");

  const regex = new RegExp(
    `\\[.+?\\]: <(?:\\[AFK\\]\\s*)?([^>]+)> !(${namePattern})${argsPattern}`,
  );

  const commandInfo: InGameCommandInfo = {
    command:
      args.length > 0
        ? `!${name} ${args
            .map((a) =>
              a.endsWith("?") ? `[${a.slice(0, -1)}]` : `<${a}>`,
            )
            .join(" ")}`
        : `!${name}`,
    description: description || `No description for !${name}`,
  };

  function init(): void {
    registerLogCommand(
      regex,
      async (
        match: RegExpExecArray,
        client: Client,
        server: ServerInstance,
      ) => {
        const username = match[1]!;

        // The slash-command paths validate Minecraft usernames
        // before interpolating them into console commands; the in-game
        // path captured `<([^>]+)>` raw. A log line can't smuggle a
        // newline (lines are pre-split) so this wasn't exploitable, but
        // handlers interpolate the name into /msg, /tellraw and
        // `/data get entity …` — enforce the same contract here for
        // parity and future-proofing.
        if (!isValidMcName(username)) {
          log.warn(
            "commands",
            `Ignoring !${name} from non-conforming username: ${JSON.stringify(username.slice(0, 32))}`,
          );
          return;
        }

        // ── Per-server command policy (live; reload/dashboard-safe) ──
        // A command disabled for this server behaves as nonexistent:
        // silent skip, debug log only. `adminOnly` requires the player's
        // LINKED Discord account to pass the global admin check (there
        // is no guild context in game chat, so guild-scoped admin lists
        // do not apply here).
        const policy = resolveCommandPolicy(name, { serverId: server?.id });
        if (!policy.enabled) {
          log.debug(
            "commands",
            `!${name} ignored on ${server?.id} (disabled for this server)`,
          );
          return;
        }
        if (policy.adminOnly) {
          const linked = await loadLinkedAccounts().catch(
            (): Record<string, string> => ({}),
          );
          const lowerName = username.toLowerCase();
          const discordId = Object.entries(linked).find(
            ([, mc]) => mc.toLowerCase() === lowerName,
          )?.[0];
          if (!discordId || !isServerAdmin(discordId)) {
            await server.sendCommand(
              `/msg ${username} ${t("command.adminOnlyInGame", { command: name })}`,
            );
            return;
          }
        }

        // ── Cooldown check ──
        if (cooldown > 0) {
          const key = `${name}:${username.toLowerCase()}`;
          const lastUsed = cooldowns.get(key) ?? 0;
          const elapsed = (Date.now() - lastUsed) / 1000;
          if (elapsed < cooldown) {
            const remaining = Math.ceil(cooldown - elapsed);
            await server.sendCommand(
              `/msg ${username} Please wait ${remaining}s before using !${name} again.`,
            );
            return;
          }
          cooldowns.set(key, Date.now());
        }

        const parsedArgs: Record<string, string | undefined> = {};
        for (let i = 0; i < args.length; i++) {
          // Greedy args are declared as "name...", optional ones as
          // "name?"; handlers read the plain "name" either way. Optional
          // args that were omitted stay undefined.
          parsedArgs[args[i]!.replace(/(\.\.\.|\?)$/, "")] = match[i + 3];
        }

        try {
          await handler(username, parsedArgs, client, server);
        } catch (err) {
          log.error(
            "commands",
            `Error in !${name} for ${username}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
  }

  return { init, COMMAND_INFO: commandInfo, handler };
}
