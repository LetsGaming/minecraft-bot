import { registerLogCommand } from "./logWatcher.js";

/**
 * Declarative in-game command definition.
 *
 * Usage:
 *   defineCommand({
 *     name: "chunkbase",
 *     description: "Get a Chunkbase link for your location",
 *     args: [],                        // or ["player"] for !playerhead <player>
 *     handler: async (username, args, client) => { ... }
 *   });
 *
 * The regex, COMMAND_INFO, and init() boilerplate are all handled automatically.
 * Commands match: [time] [Server thread/INFO]: <[AFK] PlayerName> !commandname [args...]
 */
export function defineCommand({ name, aliases = [], description, args = [], handler }) {
  const allNames = [name, ...aliases].map(n => n.replace(/^!/, ""));
  const escapedNames = allNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const namePattern = escapedNames.join("|");

  // Build args capture groups
  const argsPattern = args.map(a => `\\s+(\\S+)`).join("");
  const optionalArgs = args.length > 0 ? argsPattern : "";

  // Final regex: [time] [thread/INFO]: <[AFK] Player> !command [args]
  const regex = new RegExp(
    `\\[.+?\\]: <(?:\\[AFK\\]\\s*)?([^>]+)> !(${namePattern})${optionalArgs}`
  );

  const commandInfo = {
    command: args.length > 0 ? `!${name} ${args.map(a => `<${a}>`).join(" ")}` : `!${name}`,
    description: description || `No description for !${name}`,
  };

  function init() {
    registerLogCommand(regex, async (match, client) => {
      const username = match[1];
      // match[2] is the command name (for aliases)
      const parsedArgs = {};
      for (let i = 0; i < args.length; i++) {
        parsedArgs[args[i]] = match[i + 3]; // +3 because: [1]=user, [2]=cmdname, [3+]=args
      }
      try {
        await handler(username, parsedArgs, client);
      } catch (err) {
        console.error(`Error in !${name} handler for ${username}:`, err);
      }
    });
  }

  return { init, COMMAND_INFO: commandInfo };
}
