import path from "path";
import { fileURLToPath } from "url";
import { readdirSync, statSync } from "fs";
import config from "../config.json" assert { type: "json" };

import { watchServerLog } from "./logWatcher.js";

// Convert import.meta.url to a usable directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively get all .js files in a directory
 */
function getCommandFiles(dir) {
  let files = [];
  for (const file of readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      files = files.concat(getCommandFiles(fullPath));
    } else if (file.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Dynamically load and initialize all Minecraft chat commands
 */
export async function initMinecraftCommands(client) {
  const commandsDir = path.join(__dirname, "commands");
  const commandFiles = getCommandFiles(commandsDir);

  for (const file of commandFiles) {
    try {
      const commandModule = await import(path.resolve(file));

      if (typeof commandModule.init !== "function") {
        console.warn(`Skipping file ${file} - missing 'init' export.`);
        continue;
      }

      const commandName = path.basename(file, ".js");
      const enabled = config.commands?.[commandName]?.enabled ?? true;
      if (!enabled) {
        console.log(`Skipping disabled command: ${commandName}`);
        continue;
      }

      await commandModule.init();
      console.log(`✅ Initialized Minecraft command: ${commandName} \n\n`);
    } catch (err) {
      console.error(`❌ Failed to load Minecraft command from ${file}:`, err);
    }
  }

  console.log("✅ All Minecraft commands initialized \n\n");

  await watchServerLog(client);
}
