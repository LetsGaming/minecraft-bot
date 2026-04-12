import { registerLogCommand } from "./logWatcher.js";

const cooldowns = new Map(); // "commandName:username" -> timestamp

/**
 * Declarative in-game command definition with optional cooldowns.
 *
 * Usage:
 *   defineCommand({
 *     name: "chunkbase",
 *     description: "Get a Chunkbase link",
 *     args: [],
 *     cooldown: 10,  // seconds per player (0 = no cooldown)
 *     handler: async (username, args, client, server) => { ... }
 *   });
 */
export function defineCommand({
  name,
  aliases = [],
  description,
  args = [],
  cooldown = 0,
  handler,
}) {
  const allNames = [name, ...aliases].map((n) => n.replace(/^!/, ""));
  const escapedNames = allNames.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const namePattern = escapedNames.join("|");

  const argsPattern = args.map(() => "\\s+(\\S+)").join("");

  const regex = new RegExp(
    `\\[.+?\\]: <(?:\\[AFK\\]\\s*)?([^>]+)> !(${namePattern})${argsPattern}`,
  );

  const commandInfo = {
    command:
      args.length > 0
        ? `!${name} ${args.map((a) => `<${a}>`).join(" ")}`
        : `!${name}`,
    description: description || `No description for !${name}`,
  };

  function init() {
    registerLogCommand(regex, async (match, client, server) => {
      const username = match[1];

      // ── Cooldown check ──
      if (cooldown > 0) {
        const key = `${name}:${username.toLowerCase()}`;
        const lastUsed = cooldowns.get(key) || 0;
        const elapsed = (Date.now() - lastUsed) / 1000;
        if (elapsed < cooldown) {
          const remaining = Math.ceil(cooldown - elapsed);
          const srv = server || { sendCommand: async () => {} };
          await srv.sendCommand(
            `/msg ${username} Please wait ${remaining}s before using !${name} again.`,
          );
          return;
        }
        cooldowns.set(key, Date.now());
      }

      const parsedArgs = {};
      for (let i = 0; i < args.length; i++) {
        parsedArgs[args[i]] = match[i + 3];
      }

      try {
        await handler(username, parsedArgs, client, server);
      } catch (err) {
        console.error(`Error in !${name} for ${username}:`, err);
      }
    });
  }

  return { init, COMMAND_INFO: commandInfo };
}
