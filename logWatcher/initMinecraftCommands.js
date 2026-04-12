import path from "path";
import { fileURLToPath } from "url";
import { readdirSync, statSync, readFileSync } from "fs";
import { watchServerLog } from "./logWatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load bot config for command enable/disable settings
let botConfig = {};
try {
  botConfig = JSON.parse(readFileSync(path.resolve(process.cwd(), "config.json"), "utf-8"));
} catch { /* ignore if missing */ }

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
        console.warn(`Skipping ${file} — no init() export.`);
        continue;
      }

      const commandName = path.basename(file, ".js");
      const enabled = botConfig.commands?.[commandName]?.enabled ?? true;
      if (!enabled) {
        console.log(`⏭ Skipping disabled command: ${commandName}`);
        continue;
      }

      await commandModule.init();
      console.log(`✅ Loaded !${commandName}`);
    } catch (err) {
      console.error(`❌ Failed to load ${file}:`, err);
    }
  }

  console.log("✅ All in-game commands initialized\n");
  await watchServerLog(client);
}
