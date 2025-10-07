import {
  Client,
  Collection,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags
} from "discord.js";
import { readdirSync, statSync } from "fs";
import path from "path";
import config from "./config.json" assert { type: "json" };
import { fileURLToPath } from "url";
import { initMinecraftCommands } from "./logWatcher/initMinecraftCommands.js";

// ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Recursively load all .js command files
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

async function loadCommands() {
  const commandFiles = getCommandFiles(path.join(__dirname, "commands"));

  for (const file of commandFiles) {
    const command = await import(path.resolve(file));

    // Check if command is enabled
    const enabled = config.commands?.[command.data.name]?.enabled ?? true;

    if (command.data && command.execute && enabled) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`Skipping file ${file} - missing 'data' or 'execute'.`);
    }
  }
}

async function registerGlobalCommands() {
  const commands = client.commands.map((cmd) => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.token);

  try {
    console.log("Registering global slash commands...");
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands,
    });
    console.log("✅ Global slash commands registered.");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
}

(async () => {
  await loadCommands();
  await registerGlobalCommands();

  client.once("ready", async () => {
    console.log(`Bot is ready as ${client.user.tag} \n`);

    try {
      await initMinecraftCommands(client);
    console.log("✅ Minecraft commands initialized.");
    } catch (err) {
      console.error("❌ Failed to initialize Minecraft commands:", err);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const errorMsg = {
        content: "❌ There was an error while executing this command.",
        flags: MessageFlags.Ephemeral
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMsg);
      } else {
        await interaction.reply(errorMsg);
      }
    }
  });

  await client.login(config.token);
})();
