import { recordCommandUsage } from "@mcbot/core/utils/commands/commandUsage.js";
import { registerLogCommand } from "./logWatcher.js";
import { chatLineRegex } from "./watchers/log/chatLine.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commands/commandPolicy.js";
import {
  loadLinkedAccountsOrEmpty,
  findDiscordIdByMcName,
} from "@mcbot/core/utils/stores/linkUtils.js";
import { isServerAdmin } from "../commands/middleware.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { whisper } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { wasAccepted } from "@mcbot/schema/commandOutcome.js";
import type { Client } from "discord.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import type {
  InGameCommandDefinition,
  InGameCommandResult,
  InGameCommandInfo,
} from "@mcbot/core/types/index.js";
import { log } from "@mcbot/core/utils/logger.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { MS } from "@mcbot/schema/time.js";

const cooldowns = new Map<string, number>();

interface DeliveryTally {
  attempts: number;
  reached: number;
}

/**
 * The server a handler talks to, with every console command it sends
 * counted. Reads go through the same `send`, so a query that could not
 * reach the server counts too.
 */
function trackDelivery(
  server: ServerInstance,
  tally: DeliveryTally,
): ServerInstance {
  if (!server || typeof server.send !== "function") return server;
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== "send") return Reflect.get(target, prop, receiver);
      return async (command: string) => {
        tally.attempts++;
        const outcome = await target.send(command);
        if (wasAccepted(outcome)) tally.reached++;
        return outcome;
      };
    },
  });
}

// The map keys on `command:player`. An entry stops mattering once it is
// older than the LARGEST cooldown any command declared, so a periodic sweep
// with that horizon keeps the map proportional to recent activity. The timer
// is unref()'d: it must never keep the process (or the test runner) alive.
let maxCooldownMs = 0;
const COOLDOWN_SWEEP_INTERVAL_MS = 10 * MS.minute;

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
  // The sweep horizon must cover the longest cooldown in play.
  if (cooldown * MS.second > maxCooldownMs) maxCooldownMs = cooldown * MS.second;

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

  // Anchored speaker prefix: the name is the server's own `<name>` wrapper,
  // never a `]: <name>` a player typed later in the message.
  const regex = chatLineRegex(` !(${namePattern})${argsPattern}`);

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
        // `/data get entity …`, enforce the same contract here for
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
          const linked = await loadLinkedAccountsOrEmpty();
          const discordId = findDiscordIdByMcName(linked, username);
          if (!discordId || !isServerAdmin(discordId)) {
            await whisper(
              server,
              username,
              t("command.adminOnlyInGame", { command: name }),
            );
            return;
          }
        }

        // ── Cooldown check ──
        const cooldownKey = `${name}:${username.toLowerCase()}`;
        const previousStamp = cooldowns.get(cooldownKey);
        if (cooldown > 0) {
          const lastUsed = cooldowns.get(cooldownKey) ?? 0;
          const elapsed = (Date.now() - lastUsed) / MS.second;
          if (elapsed < cooldown) {
            const remaining = Math.ceil(cooldown - elapsed);
            await whisper(
              server,
              username,
              t("ingame.cooldown", { seconds: remaining, command: name }),
            );
            return;
          }
          // Held while the handler runs so a double-typed command cannot
          // run twice; released again below if the handler fails.
          cooldowns.set(cooldownKey, Date.now());
        }

        const parsedArgs: Record<string, string | undefined> = {};
        for (let i = 0; i < args.length; i++) {
          // Greedy args are declared as "name...", optional ones as
          // "name?"; handlers read the plain "name" either way. Optional
          // args that were omitted stay undefined.
          parsedArgs[args[i]!.replace(/(\.\.\.|\?)$/, "")] = match[i + 3];
        }

        const releaseCooldown = (): void => {
          if (cooldown <= 0) return;
          if (previousStamp === undefined) cooldowns.delete(cooldownKey);
          else cooldowns.set(cooldownKey, previousStamp);
        };
        const tally: DeliveryTally = { attempts: 0, reached: 0 };

        try {
          try {
            await handler(
              username,
              parsedArgs,
              client,
              trackDelivery(server, tally),
            );
          } catch (err) {
            releaseCooldown();
            throw err;
          }
          // Every command the handler sent failed to reach the server: the
          // player got nothing, so the attempt neither uses up the cooldown
          // nor counts as a use.
          if (tally.attempts > 0 && tally.reached === 0) {
            releaseCooldown();
            return;
          }
          // After the handler, so a command that threw is not counted.
          // The Discord id may be absent, plenty of players use !commands
          // without ever linking, and those uses still count for the
          // dashboard even though they cannot count for /help.
          recordCommandUsage({
            command: name,
            surface: "ingame",
            userId: findDiscordIdByMcName(
              await loadLinkedAccountsOrEmpty(),
              username,
            ),
            serverId: server?.id ?? null,
          });
        } catch (err) {
          log.error(
            "commands",
            `Error in !${name} for ${username}: ${errMsg(err)}`,
          );
        }
      },
    );
  }

  return { init, COMMAND_INFO: commandInfo, handler };
}
