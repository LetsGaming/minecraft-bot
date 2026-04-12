import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineCommand } from "../defineCommand.js";
import { sendToServer } from "../../utils/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadAllCommandInfo() {
  const commands = [];
  for (const file of fs.readdirSync(__dirname)) {
    if (!file.endsWith(".js") || file === "commands.js") continue;
    try {
      const mod = await import(`./${file}`);
      if (mod.COMMAND_INFO) commands.push(mod.COMMAND_INFO);
    } catch (err) {
      console.error(`Failed loading command info from ${file}:`, err);
    }
  }
  return commands;
}

const cmd = defineCommand({
  name: "commands",
  aliases: ["help", "cmds", "commandlist"],
  description: "List all available in-game commands",
  handler: async (username) => {
    const commands = await loadAllCommandInfo();
    await sendToServer(`/msg ${username} Available commands:`);
    for (const c of commands) {
      await sendToServer(`/msg ${username}  ${c.command} - ${c.description}`);
    }
  },
});

export const { init, COMMAND_INFO } = cmd;
