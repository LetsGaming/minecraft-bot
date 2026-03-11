import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { registerLogCommand } from "../logWatcher.js";
import { sendToServer } from "../../utils/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALIASES = ["!commands", "!help", "!cmds", "!commandlist"];

// Escape regex special characters
const escapedAliases = ALIASES.map((a) =>
  a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

// Build regex dynamically
const COMMANDS_REGEX = new RegExp(
  `\\[.+?\\]: <(?:\\[AFK\\]\\s*)?([^>]+)> (${escapedAliases.join("|")})`,
);

async function loadCommands() {
  const commandsDir = __dirname;
  const files = fs.readdirSync(commandsDir);

  const commands = [];

  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    if (file === "commands.js") continue;

    try {
      const module = await import(`./${file}`);

      if (module.COMMAND_INFO) {
        commands.push(module.COMMAND_INFO);
      }
    } catch (err) {
      console.error(`Failed loading command ${file}`, err);
    }
  }

  return commands;
}

async function handleCommandsCommand(match) {
  const user = match[1];

  try {
    const commands = await loadCommands();

    await sendToServer(`/msg ${user} Available commands:`);

    for (const cmd of commands) {
      await sendToServer(`/msg ${user} ${cmd.command} - ${cmd.description}`);
    }
  } catch (err) {
    console.error("Error loading commands:", err);
    await sendToServer(`/msg ${user} Error loading commands.`);
  }
}

export function init() {
  registerLogCommand(COMMANDS_REGEX, handleCommandsCommand);
  console.log("🔥 !commands command handler registered");
}
