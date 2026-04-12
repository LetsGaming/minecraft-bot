import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineCommand } from "../defineCommand.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadAllCommandInfo() {
  const commands = [];
  for (const file of fs.readdirSync(__dirname)) {
    if (!file.endsWith(".js") || file === "commands.js") continue;
    try {
      const mod = await import(`./${file}`);
      if (mod.COMMAND_INFO) commands.push(mod.COMMAND_INFO);
    } catch {
      /* skip */
    }
  }
  return commands;
}

const cmd = defineCommand({
  name: "commands",
  aliases: ["help", "cmds", "commandlist"],
  description: "List all available in-game commands",
  cooldown: 5,
  handler: async (username, args, client, server) => {
    const commands = await loadAllCommandInfo();
    await server.sendCommand(`/msg ${username} Available commands:`);
    for (const c of commands) {
      await server.sendCommand(
        `/msg ${username}  ${c.command} - ${c.description}`,
      );
    }
  },
});
export const { init, COMMAND_INFO } = cmd;
